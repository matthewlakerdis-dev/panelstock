"""Local unit tests for the real converter function, without starting a server."""
import ast
import types
import unittest
from pathlib import Path


class PaginationTest(unittest.TestCase):
    def convert(self, count, fail=False, width=18000, height=30000):
        tree = ast.parse(Path(__file__).with_name("server.py").read_text())
        functions = [node for node in tree.body if isinstance(node, ast.FunctionDef)]
        sheets = []
        for index in range(count):
            sheet = types.SimpleNamespace(PageStyle=str(index), areas=None)
            sheet.columns = [types.SimpleNamespace(Width=width // 14, IsVisible=True) for _ in range(14)]
            columns = types.SimpleNamespace(getCount=lambda: 14, getByIndex=sheet.columns.__getitem__)
            area = types.SimpleNamespace(RangeAddress=(index, "A1:N50"), Size=types.SimpleNamespace(Width=width, Height=height), getColumns=lambda c=columns: c)
            sheet.getCellRangeByName = lambda name, a=area: a
            sheet.logo = types.SimpleNamespace(size=(3200, 1500), restored=False)
            sheet.logo.getSize = lambda logo=sheet.logo: logo.size
            def restore(size, logo=sheet.logo):
                logo.size = size
                logo.restored = True
            sheet.logo.setSize = restore
            sheet.getDrawPage = lambda logo=sheet.logo: types.SimpleNamespace(getCount=lambda: 1, getByIndex=lambda _: logo)
            sheet.setPrintAreas = lambda areas, target=sheet: setattr(target, "areas", areas)
            sheets.append(sheet)
        styles = {str(index): types.SimpleNamespace() for index in range(count)}
        document = types.SimpleNamespace(
            Sheets=types.SimpleNamespace(getCount=lambda: count, getByIndex=lambda i: sheets[i]),
            StyleFamilies=types.SimpleNamespace(getByName=lambda _: types.SimpleNamespace(getByName=styles.get)),
            closed=False, exported=None,
        )
        def export(url, options):
            if fail:
                raise RuntimeError("synthetic export failure")
            document.exported = (url, options)
        document.storeToURL = export
        document.close = lambda _: setattr(document, "closed", True)
        desktop = types.SimpleNamespace(loadComponentFromURL=lambda *args: document)
        remote = types.SimpleNamespace(ServiceManager=types.SimpleNamespace(createInstanceWithContext=lambda *args: desktop))
        resolver = types.SimpleNamespace(resolve=lambda _: remote)
        local = types.SimpleNamespace(ServiceManager=types.SimpleNamespace(createInstanceWithContext=lambda *args: resolver))
        context = {"uno": types.SimpleNamespace(getComponentContext=lambda: local), "PropertyValue": types.SimpleNamespace, "Path": Path}
        exec(compile(ast.Module(body=functions, type_ignores=[]), "server.py", "exec"), context)
        try:
            context["convert_xlsx"](Path("order.xlsx").resolve(), Path("order.pdf").resolve())
        except RuntimeError:
            if not fail:
                raise
        return sheets, styles, document

    def test_every_continuation_is_printed_as_one_a4_page(self):
        for count in (1, 2, 10):
            sheets, styles, document = self.convert(count)
            for index, sheet in enumerate(sheets):
                self.assertEqual(sheet.areas, ((index, "A1:N50"),))
                self.assertEqual(styles[str(index)].ScaleToPagesX, 1)
                self.assertEqual(styles[str(index)].ScaleToPagesY, 1)
                self.assertEqual(styles[str(index)].Width, 21000)
                self.assertEqual(styles[str(index)].Height, 29700)
            self.assertIsNotNone(document.exported)
            self.assertTrue(document.closed)

    def test_document_is_closed_when_export_fails(self):
        _, _, document = self.convert(2, fail=True)
        self.assertTrue(document.closed)

    def test_height_limited_pages_fill_available_width_without_stretching_logo(self):
        sheets, _, _ = self.convert(2)
        for sheet in sheets:
            expected_width = 30000 * 20000 / 29700
            self.assertAlmostEqual(sum(c.Width for c in sheet.columns), expected_width, delta=20)
            self.assertEqual(sheet.logo.size, (3200, 1500))
            self.assertTrue(sheet.logo.restored)

    def test_width_limited_pages_are_not_shrunk(self):
        sheets, _, _ = self.convert(1, width=28000, height=30000)
        self.assertEqual([c.Width for c in sheets[0].columns], [2000] * 14)
        self.assertFalse(sheets[0].logo.restored)


if __name__ == "__main__":
    unittest.main()
