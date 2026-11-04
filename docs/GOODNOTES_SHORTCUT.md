# Share a Goodnotes PDF into a new Site Order

This integration is for the standalone **Site Orders** app at
https://site.panelstockhq.com. iPadOS does not support a web app as a native
file-sharing destination, so an Apple Shortcut provides the handoff.

The user exports one PDF from Goodnotes, runs **New Site Order** from the Share
menu, and opens a private account draft with the PDF already attached. They then
choose the project and order type, fill in the items and requested delivery date,
and submit normally. Name and phone use their current account details. Importing
a PDF does not submit an order, allocate an order number, send an email or change
production, QA, dispatch, or notification state. The normal PDF/file email flow
runs when the user submits the completed order.

## One-time setup on each iPad

1. Sign in to Site Orders using the intended user's account. Open **Settings →
   Goodnotes sharing → Set up sharing**. Name the iPad and choose **Create
   Shortcut key**. Copy the entire `Bearer …` value. It is only displayed during
   this session; the server stores a hash, not the key itself.
2. In Apple's **Shortcuts** app, create a shortcut named **New Site Order**. In
   Details, enable **Show in Share Sheet**, accept **PDFs** only, and set the
   no-input behavior to **Stop and Respond**. Export just one document per run.
3. Add these built-in Apple actions in order. No third-party Actions app or
   UUID generator is required:

| Action | Configuration |
| --- | --- |
| Get Name | Get the name of **Shortcut Input**. Keep the `.pdf` extension. |
| Base64 Encode | Encode **Shortcut Input**, explicitly selecting the original PDF rather than the preceding Name result. Set line breaks to **None**. |
| Current Date | Get the current date. |
| Format Date | Format Current Date using **Custom** format `yyyyMMddHHmmssSSS`. |
| Random Number | Generate a whole number from **100000000** to **999999999**. |
| Text | Combine the variables as **[Formatted Date]-[Random Number]**. This is the retry ID for this share. |
| Get Contents of URL | URL: `https://panelstock-reports.matthewlakerdis.workers.dev/order-share/import`. Method: **POST**. Header `Authorization`: the full `Bearer …` value from Settings. Request body: **JSON**. Add text fields `id` = the combined Text, `name` = Name, and `data` = Base64 Encoded, using the output variables from the preceding actions. |
| Get Dictionary Value | Get **openUrl** from **Contents of URL**. |
| If | If Dictionary Value **has any value**, use **Open URLs** with Dictionary Value. Under Otherwise, use **Show Alert** with Contents of URL. End If. |

4. In Goodnotes, export a single **PDF up to 5 MB**, tap Share, and select **New
   Site Order**. Allow the Shortcut's connection to PanelStock when prompted.
5. The Shortcut opens **Safari**, which may require signing in. Use the same
   account that created the sharing key. A different signed-in account cannot
   open that user's draft. The draft also appears under **My drafts** in the
   installed Site Orders app. The Shortcut cannot guarantee launching that
   installed app instead of Safari.

There is no pre-signed `.shortcut` installer or iCloud installation link in this
repository. The instructions above let users build it directly on the iPad.
Apple signing and publishing would require an Apple device/account; this feature
has no dependency on an unsigned file importer or a third-party shortcut service.

## Limits and recovery

- Up to **5 separately revocable iPad keys per account**, each valid for **90
  days**. Each user creates their own keys; do not distribute a configured
  Shortcut containing someone else's key.
- Keys only authorize new private PDF draft imports. They cannot log in, read
  drafts, read orders, submit orders, or change any status. Normal login is
  required to open the resulting draft.
- **Remove** disconnects a key without deleting existing drafts. Expiry, disabled
  accounts, PIN changes, Site app restrictions and revoked order-create access
  prevent further imports. Create a new key and update the Shortcut when needed.
- Existing account limits still apply: **20 saved drafts**, a **5 MB** file limit,
  and the normal attachment limits after editing. Sharing also permits at most
  **60 new upload attempts per account per hour** and **60 requests per IP address
  per 15 minutes**. Successful request-ID retries do not consume the account
  upload allowance.
- Keep the same retry ID, name and PDF when retrying a failed HTTP request. Repeating
  that request returns the same draft link, even after the draft is deleted or
  submitted. Starting the Shortcut again generates a new retry ID and intentionally
  creates a new draft.
- Each upload attempt uses a unique private R2 object. Draft creation and its
  deduplication receipt commit together. Failed/losing attempts clean up only
  their own object. Existing draft APIs download and discard imported files.
- Opening a shared draft first saves an unfinished local draft to the account.
  If that save, file download or device storage fails, the old editor state and
  shared link remain available for retry. The shared PDF remains in My drafts.
  Dismiss only closes the handoff banner; it does not delete the account draft.

## Verification

Worker unit tests cover file validation, private ownership, per-user/device
limits, hashing and revocation, live permission/account/PIN changes, in-flight
revocation and concurrent/lost-response retries. An integration test runs the
actual Worker and verifies scoped-key restrictions, normal authenticated draft
and file reads, unchanged orders, permission removal and revocation. Client tests
exercise sign-in/workspace readiness, account mismatch, preservation of an
unfinished draft, file restoration and storage/download failure recovery.

A physical iPad with Goodnotes and Apple Shortcuts is still needed to confirm
Apple's permission prompts and the exact action labels for the team's iPadOS
version. Browser emulation does not validate Apple's native Share menu.
