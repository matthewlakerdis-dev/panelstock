import base64
import io
import json
import os
import unittest
import urllib.error
from contextlib import redirect_stdout
from unittest.mock import patch

from material_import import analyse, validate_result, ImportUnavailable
from provider_retry import ProviderRetry


def pdf(pages=1):
    import pypdfium2 as pdfium
    document = pdfium.PdfDocument.new()
    for _ in range(pages):
        document.new_page(200, 200)
    output = io.BytesIO()
    document.save(output)
    document.close()
    return {'name': 'materials.pdf', 'data': base64.b64encode(output.getvalue()).decode()}


def materials():
    return {'supplier': '', 'warnings': ['Check missing units before importing.'], 'lines': [
        {'sku': '001-ANG/30', 'description': 'Aluminium angle 30 x 30', 'colour': 'Black',
         'dimensions': '30 x 30', 'lengthMm': 6000, 'unit': 'lengths', 'category': 'extrusions', 'supplier': 'Metal supplier'},
        {'sku': '001-ANG/30', 'description': 'Aluminium angle 30 x 30', 'colour': 'White',
         'dimensions': '30 x 30', 'lengthMm': 3000, 'unit': '', 'category': '', 'supplier': ''}]}


def priced_materials():
    """Synthetic source rows; never embed a customer's PDF or product codes."""
    profiles = [
        ('000-ANG/1', 'Angle', '30X20X2', 11.25),
        ('000-ANG/2', 'Angle', '40X40X2', 22.50),
        ('000-CH/1', 'Channel', '35X35X2', 31.70),
        ('000-CH/2', 'Channel', '55X45X2', 45.21),
        ('000-RHS', 'RHS', '140X40X2', 83.44),
        ('000-SH', 'Square Hollow', '35X2', 54.12),
        ('000-RHS', 'RHS', '140X40X2', 83.44),
    ]
    return {'supplier': 'Example Metals', 'warnings': [], 'lines': [
        {'sku': sku, 'name': name, 'description': f'PROFILE-{index} 6060 T5 6.5m MF {name.upper()} {dimensions}',
         'colour': 'Mill Finish', 'dimensions': dimensions, 'lengthMm': 6500,
         'unit': 'EA', 'stockUnit': 'lengths', 'category': 'extrusions', 'supplier': 'Example Metals',
         'unitCost': cost, 'priceUnit': 'EA', 'currency': 'AUD', 'taxBasis': 'exGST'}
        for index, (sku, name, dimensions, cost) in enumerate(profiles)
    ]}


class Response:
    def __init__(self, value=None, raw=None):
        self.raw = raw if raw is not None else json.dumps({'status': 'completed', 'output': [
            {'type': 'message', 'content': [{'type': 'output_text', 'text': json.dumps(value or materials())}]}]}).encode()
    def __enter__(self): return self
    def __exit__(self, *args): pass
    def read(self, limit): return self.raw[:limit]


class MaterialImportTests(unittest.TestCase):
    def test_pdf_request_is_private_and_keeps_codes_variants_vendor_and_uncertain_unit(self):
        source = pdf(2)
        source.update({'stock': 'PRIVATE_STOCK', 'supplier': 'UNTRUSTED_DEFAULT', 'quantity': 500})
        captured = []
        def open_request(request, timeout):
            captured.append((json.loads(request.data), timeout))
            return Response()
        with patch.dict(os.environ, {'OPENAI_API_KEY': 'test-only', 'CAD_AI_MODEL': 'test-model'}, clear=True), patch('urllib.request.urlopen', open_request):
            result = analyse(source)
        payload, timeout = captured[0]
        self.assertFalse(payload['store'])
        self.assertTrue(payload['text']['format']['strict'])
        self.assertNotIn('PRIVATE_STOCK', json.dumps(payload))
        self.assertNotIn('UNTRUSTED_DEFAULT', json.dumps(payload))
        self.assertLessEqual(timeout, 70)
        self.assertEqual(payload['input'][0]['content'][1]['filename'], 'material-list.pdf')
        fields = payload['text']['format']['schema']['properties']['lines']['items']['properties']
        self.assertNotIn('quantity', fields)
        self.assertNotIn('stockBalance', fields)
        self.assertNotIn('lineTotal', fields)
        self.assertEqual(fields['unitCost']['type'], ['number', 'null'])
        self.assertEqual(fields['taxBasis']['enum'], ['exGST', 'incGST', 'unknown'])
        self.assertIn('lengths', fields['stockUnit']['enum'])
        self.assertIn('each', fields['stockUnit']['enum'])
        new_fields = {'name', 'stockUnit', 'unitCost', 'priceUnit', 'currency', 'taxBasis'}
        row_schema = payload['text']['format']['schema']['properties']['lines']['items']
        self.assertTrue(new_fields.issubset(row_schema['required']))
        self.assertFalse(row_schema['additionalProperties'])
        self.assertEqual(result['lines'][0]['sku'], '001-ANG/30')
        self.assertEqual(result['lines'][1]['sku'], '001-ANG/30')
        self.assertEqual(result['lines'][0]['supplier'], 'Metal supplier')
        self.assertEqual(result['lines'][1]['unit'], '')
        self.assertEqual(result['lines'][1]['category'], '')
        self.assertEqual(result['lines'][1]['lengthMm'], 3000)
        self.assertIn('not necessarily a purchase order', payload['instructions'])
        self.assertIn('issuing company', payload['instructions'])
        self.assertIn('Exclude panel sheets', payload['instructions'])
        self.assertIn('Do not return quantities or stock balances', payload['instructions'])
        self.assertIn('6.5m becomes 6500', payload['instructions'])
        self.assertIn('24mm spacer', payload['instructions'])
        self.assertIn('normalizing an explicit MF or Mill Finish finish to Mill Finish', payload['instructions'])
        self.assertIn('never derive a unit price by dividing a line total by quantity', payload['instructions'])
        self.assertIn('Value (AUD)', payload['instructions'])
        self.assertIn('Total GST', payload['instructions'])
        self.assertIn('A dollar sign alone does not establish AUD', payload['instructions'])

    def test_non_pdf_invalid_encoding_and_page_limit_are_rejected_before_provider(self):
        cases = [None, {}, {'name': 'list.xlsx', 'data': 'JVBERg=='}, {'name': 'list.pdf', 'data': 'not base64'},
                 {'name': 'list.pdf', 'data': base64.b64encode(b'<html>not PDF</html>').decode()}, pdf(21)]
        with patch('urllib.request.urlopen') as provider:
            for source in cases:
                with self.subTest(source_type=type(source).__name__):
                    with self.assertRaises(ValueError): analyse(source)
            provider.assert_not_called()

    def test_validation_never_returns_stock_quantities_or_fabricated_matches_and_rejects_partial_rows(self):
        value = materials()
        value['lines'][0].update({'quantity': 123, 'unitCost': 90, 'itemId': 'fabricated-match'})
        value['lines'][1]['lengthMm'] = float('nan')
        result = validate_result(value)
        self.assertNotIn('quantity', result['lines'][0])
        self.assertEqual(result['lines'][0]['unitCost'], 90)
        self.assertNotIn('itemId', result['lines'][0])
        self.assertIsNone(result['lines'][1]['lengthMm'])
        for value in [None, {'lines': [{}] * 201}, {'lines': [None]}, {'lines': [{'sku': 'X' * 101}]},
                      {'lines': [{'category': 'panels'}]}, {'lines': [{'description': 4}]}, {'lines': [], 'warnings': 'bad'}]:
            with self.subTest(value_type=type(value).__name__):
                with self.assertRaises(ValueError): validate_result(value)

    def test_missing_new_fields_have_safe_backwards_compatible_defaults(self):
        result = validate_result(materials())
        for row in result['lines']:
            self.assertEqual({key: row[key] for key in ('name', 'stockUnit', 'unitCost', 'priceUnit', 'currency', 'taxBasis')},
                             {'name': '', 'stockUnit': '', 'unitCost': None, 'priceUnit': '', 'currency': '', 'taxBasis': 'unknown'})
        self.assertTrue(any('unclear or missing' in warning for warning in result['warnings']))

    def test_synthetic_unit_prices_names_specs_and_duplicate_order_survive_provider(self):
        expected = priced_materials()
        with patch.dict(os.environ, {'OPENAI_API_KEY': 'test-only', 'MATERIAL_IMPORT_MODEL': 'materials-model'}, clear=True), patch('urllib.request.urlopen', return_value=Response(expected)):
            result = analyse(pdf())
        self.assertEqual(result['lines'], expected['lines'])
        self.assertEqual([row['unitCost'] for row in result['lines']], [11.25, 22.50, 31.70, 45.21, 83.44, 54.12, 83.44])
        self.assertEqual([row['sku'] for row in result['lines']], [row['sku'] for row in expected['lines']])
        self.assertEqual(result['lines'][4]['sku'], result['lines'][6]['sku'])
        self.assertEqual(result['lines'][0]['name'], 'Angle')
        self.assertIn('6060 T5 6.5m MF', result['lines'][0]['description'])
        self.assertEqual(result['lines'][0]['unit'], 'EA')
        self.assertEqual(result['lines'][0]['stockUnit'], 'lengths')
        self.assertEqual(result['warnings'], [])

    def test_printed_zero_and_cents_are_valid_and_no_line_total_price_is_derived(self):
        for cost in [0, 0.29, 11.25, 1000000000]:
            value = priced_materials()
            value['lines'][0].update({'unitCost': cost, 'quantity': 40, 'lineTotal': 450.00})
            row = validate_result(value)['lines'][0]
            self.assertEqual(row['unitCost'], cost)
            self.assertNotIn('quantity', row)
            self.assertNotIn('lineTotal', row)
        value['lines'][0].pop('unitCost')
        result = validate_result(value)
        self.assertIsNone(result['lines'][0]['unitCost'])
        self.assertTrue(result['warnings'])

    def test_discrete_parts_keep_each_and_foreign_or_inclusive_prices_stay_as_printed(self):
        value = priced_materials()
        value['lines'][0].update({'name': 'Spacer', 'description': '24mm nylon spacer', 'lengthMm': None,
                                 'stockUnit': 'each', 'category': 'fixings', 'unitCost': 7.70,
                                 'currency': 'USD', 'taxBasis': 'incGST'})
        row = validate_result(value)['lines'][0]
        self.assertEqual(row['stockUnit'], 'each')
        self.assertEqual(row['unit'], 'EA')
        self.assertIsNone(row['lengthMm'])
        self.assertEqual((row['unitCost'], row['priceUnit'], row['currency'], row['taxBasis']), (7.70, 'EA', 'USD', 'incGST'))

    def test_uncertain_price_metadata_stays_uncertain_and_requires_review(self):
        for changes in [{'unitCost': None}, {'priceUnit': ''}, {'currency': ''}, {'taxBasis': 'unknown'}]:
            with self.subTest(changes=changes):
                value = priced_materials()
                value['lines'][0].update(changes)
                result = validate_result(value)
                for key, expected in changes.items():
                    self.assertEqual(result['lines'][0][key], expected)
                self.assertTrue(any('Review them' in warning for warning in result['warnings']))
        value['warnings'] = ['Review source text.'] * 20
        bounded = validate_result(value)['warnings']
        self.assertEqual(len(bounded), 20)
        self.assertTrue(any('Review them' in warning for warning in bounded))
        value['warnings'] = ['x' * 500] * 20
        with self.assertRaisesRegex(ValueError, 'too many review warnings'):
            validate_result(value)

    def test_invalid_price_and_mapping_metadata_is_rejected(self):
        bad_fields = {
            'unitCost': [True, False, '11.25', -1, 1000000000.01, 10 ** 1000, 0.001, 11.251, float('nan'), float('inf'), -float('inf'), [], {}],
            'name': [3, 'x' * 161],
            'stockUnit': ['EA', 'sheets', 1],
            'priceUnit': [3, 'x' * 41],
            'currency': ['$', 'aud', 'AU', 'AUD ', 1],
            'taxBasis': ['', 'ex', 'inclusive', True, None],
        }
        for field, invalid_values in bad_fields.items():
            for invalid in invalid_values:
                with self.subTest(field=field, invalid=invalid):
                    value = priced_materials()
                    value['lines'][0][field] = invalid
                    with self.assertRaises(ValueError):
                        validate_result(value)

    def test_provider_recovers_temporary_failure_with_bounded_retry_without_resending_stock(self):
        source = pdf()
        now = [0.0]
        retry = ProviderRetry(clock=lambda: now[0], sleep=lambda delay: now.__setitem__(0, now[0] + delay), retry_statuses=(429, 500, 502, 503, 504))
        error = urllib.error.HTTPError('https://api.openai.com/v1/responses', 503, 'temporarily unavailable', {}, io.BytesIO(b'{}'))
        with patch.dict(os.environ, {'OPENAI_API_KEY': 'test-only', 'MATERIAL_IMPORT_MODEL': 'materials-model'}, clear=True), patch('material_import.PO_PROVIDER_RETRY', retry), patch('material_import.time.monotonic', lambda: now[0]), patch('urllib.request.urlopen', side_effect=[error, Response()]) as provider:
            self.assertEqual(analyse(source)['lines'][0]['sku'], '001-ANG/30')
        self.assertEqual(provider.call_count, 2)
        self.assertEqual(now[0], 2)
        self.assertEqual(provider.call_args_list[0].args[0].data, provider.call_args_list[1].args[0].data)
        self.assertLessEqual(provider.call_args_list[1].kwargs['timeout'], 68)

    def test_provider_failure_is_categorised_without_leaking_credentials_or_document_text(self):
        source = pdf()
        secret = 'SYNTHETIC_PRIVATE_KEY_AND_DOCUMENT'
        error = urllib.error.HTTPError('https://api.openai.com/v1/responses', 401, secret, {}, io.BytesIO(json.dumps({'error': {'code': 'invalid_api_key', 'message': secret}}).encode()))
        logs = io.StringIO()
        with patch.dict(os.environ, {'OPENAI_API_KEY': 'test-only', 'CAD_AI_MODEL': 'test-model'}, clear=True), patch('urllib.request.urlopen', side_effect=error), redirect_stdout(logs):
            with self.assertRaisesRegex(ImportUnavailable, 'API key') as failure:
                analyse(source)
        self.assertIn('material_import upstream_http_status=401 category=authentication', logs.getvalue())
        self.assertNotIn(secret, logs.getvalue() + str(failure.exception))

    def test_incomplete_invalid_or_oversized_reading_cannot_be_imported(self):
        source = pdf()
        for response in [Response(raw=b'{"status":"incomplete"}'), Response(raw=b'[]'),
                         Response(raw=b'not JSON'), Response(raw=b'x' * (512 * 1024 + 1)),
                         Response(raw=b'{"status":"completed","output":[null]}')]:
            with patch.dict(os.environ, {'OPENAI_API_KEY': 'test-only', 'CAD_AI_MODEL': 'test-model'}, clear=True), patch('urllib.request.urlopen', return_value=response):
                with self.assertRaises((ValueError, ImportUnavailable)):
                    analyse(source)


if __name__ == '__main__':
    unittest.main()
