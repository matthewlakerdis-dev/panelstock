# Panel CAD integration

The separate `/cad/` page in the `panelstock-desktop` web app reads a sketch, presents site and proposed finished dimensions for review, generates a deterministic preview and downloads an AutoCAD DXF. Admins and users with `factory.cnc` access can use the authenticated CAD endpoints. The standard/mobile app and Site Orders app do not expose Panel CAD. CAD operations do not write inventory, CNC tracking or offline mutation records. Drafts are explicitly downloaded/uploaded as JSON; they are not shared project records in this version.

## Components

- `panelstock-desktop/cad/`: responsive page with login/session reuse, upload, editable edge table, review gate, preview and DXF/draft downloads.
- `worker/src/cad-api.js` and `/cad/analyse`, `/cad/generate` routes: existing session/permission checks, bounded input/output and authenticated converter calls.
- `converter/cad_ai.py`: OpenAI Responses API sketch extraction; strict schema, no tools or code execution, store=false, uploads treated as data. Missing/unclear dimensions remain unresolved. No provider key reaches the browser.
- `converter/panel_cad.py`: deterministic generation and validation, independent of the model. NT/RE 20 mm tags are hole-free. Single closed CUT outline; red ROUTE, separate dark-blue CAP ROUTE 0.4 mm outside CUT, light-blue HOLES, LABELS as Arial MTEXT and native DIMENSIONS.
- Desktop repository: the only Panel CAD frontend assets, plus a Panel CAD entry in the CNC menu. Its shared stock client is unchanged.

## Supported first release

Orthogonal rectangular and stepped outlines, FE/CR edges, B/S/NT/RE tags, square outside corners, combined inside corners, full-width horizontal folds in rectangular all-tag panels (94-degree notches), and centred stiffeners on rectangular portions longer than 900 mm. Stiffeners stop 50 mm short of internal folds. B/S attachment pairs are 50 mm apart within a 60 mm fixing span; NT/RE remain hole-free. The generator requires reviewed finished dimensions and validates both site and finished outline closure. It does not silently apply additional deductions after user review.

Non-orthogonal outlines, partial/vertical internal folds, ambiguous stiffener orientation, irregular stiffener placement, internal cutouts and unknown geometry are blocked for review. AI extraction accuracy still requires a live configured-model trial and human review. Tool widths, route depths and production release approval are not inferred.

## Deployment order

1. Build/deploy the updated converter image in staging. Existing converter authentication still uses `CONVERTER_TOKEN`.
2. Set `OPENAI_API_KEY` as a server secret and `CAD_AI_MODEL` to an account-available model supporting image/PDF inputs and strict structured outputs. No default model is silently chosen. Keep these on the converter only.
3. Deploy the Worker with the existing `PDF_CONVERTER_URL` and `PDF_CONVERTER_TOKEN` pointing at that converter. Existing CORS origins and stock bindings remain unchanged.
4. Publish the `cad/` assets and navigation update in the desktop web repository only. Test using a permitted account, a denied account and one approved sketch before production rollout.

No migrations or stock resets are required. Revert the desktop CAD link/assets and CAD routes to roll back; stock data is untouched. This is a draft pull request and has not been deployed. Live OpenAI calls and Docker/LibreOffice runtime were not tested in this workspace; missing AI configuration fails explicitly. The mock browser test does not prove live sketch recognition.

## Verification

The Worker dry build and full `npm test` suite pass (202 tests). Test fixtures and Tailwind scanning now read the current split standard-app bundles; no standard-app interface files changed. Converter: `python -m unittest discover -s converter -p test_panel_cad.py -v` passes five tests covering the seven approved examples with ezdxf/shapely/Pillow installed. Desktop: `npm test` passed.

Reference: [OpenAI file inputs](https://developers.openai.com/api/docs/guides/file-inputs), [structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [Cloudflare Workers practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/).
