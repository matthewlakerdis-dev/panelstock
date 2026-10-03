"""User-transferred Copilot readings. No provider requests or credentials."""
import base64
import hashlib
import json
import math
import re
from panel_cad import CadError
from pack_reader import schema, INSTRUCTIONS, policy_context, validate_inventory, compare_readings

REVISION = 'manual-copilot-v1'
READER = 'pack-dimensions-v8'


def check_schema(value, rule, path='inventory', depth=0):
    """Validate the strict extraction schema without trusting pasted JSON types."""
    if depth > 40:
        raise CadError('Copilot response is nested too deeply.')
    kind = ('null' if value is None else 'boolean' if type(value) is bool else
            'integer' if type(value) is int else 'number' if type(value) is float else
            'string' if isinstance(value, str) else 'array' if isinstance(value, list) else
            'object' if isinstance(value, dict) else 'invalid')
    allowed = rule.get('type', [])
    if isinstance(allowed, str): allowed = [allowed]
    if kind not in allowed and not (kind == 'integer' and 'number' in allowed):
        raise CadError(path + ': incorrect value type.')
    if 'enum' in rule and value not in rule['enum']:
        raise CadError(path + ': unsupported value.')
    if kind in ('integer', 'number'):
        try: finite = math.isfinite(value)
        except OverflowError: finite = False
        if not finite or value < rule.get('minimum', -math.inf) or value > rule.get('maximum', math.inf):
            raise CadError(path + ': invalid number.')
    if kind == 'string' and len(value) > 12000:
        raise CadError(path + ': text is too long.')
    if kind == 'array':
        if not rule.get('minItems', 0) <= len(value) <= min(rule.get('maxItems', 1000), 1000):
            raise CadError(path + ': invalid list length.')
        for i, item in enumerate(value): check_schema(item, rule['items'], path + '[' + str(i) + ']', depth+1)
    if kind == 'object':
        properties = rule.get('properties', {})
        missing = set(rule.get('required', [])) - value.keys()
        if missing: raise CadError(path + ': missing ' + ', '.join(sorted(missing)) + '.')
        if rule.get('additionalProperties') is False and value.keys() - properties.keys():
            raise CadError(path + ': unexpected fields.')
        for key, item in value.items():
            if key in properties: check_schema(item, properties[key], path+'.'+key, depth+1)


def read_response(text, source_id, reading):
    if not isinstance(text, str) or not 1 <= len(text.encode('utf-8')) <= 512*1024:
        raise CadError('Paste a Copilot JSON response no larger than 512 KB.')
    text = text.strip()
    fence = re.fullmatch(r'```(?:json)?\s*\n(.*?)\n```', text, re.S | re.I)
    if fence: text = fence.group(1)
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result: raise ValueError('Duplicate JSON key')
            result[key] = value
        return result
    try:
        value = json.loads(text, object_pairs_hook=unique, parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
    except (ValueError, RecursionError):
        raise CadError('Copilot response must be one valid JSON object; copy the complete response.') from None
    if not isinstance(value, dict) or set(value) != {'sourceId','reading','inventory'}:
        raise CadError('Copy the complete response including sourceId, reading and inventory.')
    if value['sourceId'] != source_id or type(value['reading']) is not int or value['reading'] != reading:
        raise CadError('This response belongs to another page, set of settings or reading. Use its matching prompt.')
    check_schema(value['inventory'], schema())
    return validate_inventory(value['inventory'])


def process_manual(body):
    from cad_ai import sketch_image
    mime = body.get('mime')
    magic = {'application/pdf': b'%PDF-', 'image/png': b'\x89PNG\r\n\x1a\n', 'image/jpeg': b'\xff\xd8\xff'}
    try:
        raw = base64.b64decode(body.get('data',''), validate=True)
    except (ValueError, TypeError):
        raise CadError('Invalid drawing encoding.') from None
    if mime not in magic or not 1 <= len(raw) <= 6*1024*1024 or not raw.startswith(magic[mime]):
        raise CadError('Upload a valid single-page PDF, PNG or JPEG no larger than 6 MB.')
    policy = body.get('policy') or {}
    if not isinstance(policy, dict): raise CadError('Invalid drawing settings.')
    context = policy_context(policy)
    source_id = hashlib.sha256(raw + json.dumps({'policy':policy,'mime':mime,'revision':REVISION,'reader':READER},sort_keys=True,allow_nan=False).encode()).hexdigest()
    mode = body['mode']
    if mode == 'copilot-prepare':
        reading = body.get('reading')
        if type(reading) is not int or reading not in (1,2): raise CadError('Choose reading 1 or 2.')
        item = sketch_image(raw, mime, preserve_frame=True)
        prompt = (INSTRUCTIONS + '\n' + context +
                  '\nRead only the attached ORIGINAL source page. Do not use completed CAD or previous readings. '
                  'Start from the source again in this new chat; do not copy another answer. '
                  'Record unclear annotations as issues/questions; never guess them to make geometry pass. '
                  'Return JSON only, without commentary, matching the inventory schema below. '
                  'Wrap the inventory in an object with exactly sourceId, reading, inventory. '
                  'Use sourceId=' + json.dumps(source_id) + ', reading=' + str(reading) + '.\n' +
                  json.dumps(schema(),separators=(',',':')))
        return {'ok':True,'prompt':prompt,'sourceImage':item['image_url'],'sourceId':source_id,'reading':reading,'readerVersion':READER}
    if mode == 'copilot-read':
        inventory = read_response(body.get('response'),source_id,1)
        return {'ok':True,'inventory':inventory,'readerVersion':READER,'readerModel':'Microsoft 365 Copilot (manual transfer)'}
    if mode != 'copilot-verify': raise CadError('Unknown manual reading action.')
    if body.get('independentConfirmed') is not True:
        raise CadError('Confirm the second reading was made in a separate fresh Copilot chat.')
    first = read_response(body.get('firstResponse'),source_id,1)
    second = read_response(body.get('response'),source_id,2)
    result = compare_readings(first,second,policy)
    result['verificationMethod'] = 'Two user-supplied readings compared; source accuracy requires operator review.'
    return result
