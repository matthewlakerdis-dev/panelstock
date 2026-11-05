# Set up the “New Site Order” iPad Shortcut

This guide connects Goodnotes to the standalone **Site Orders** app at
https://site.panelstockhq.com. Once set up, you can export a Goodnotes drawing as
a PDF, choose **New Site Order** from the iPad Share menu, and complete a draft
with the PDF already attached.

Use the same user account on this iPad throughout setup. You will need Apple's
**Shortcuts** app and one PDF **5 MB or smaller** for your first test. Keep Site
Orders open while building the shortcut; you can switch between the two apps.

## 1. Get a sharing key for this iPad

1. Sign in to **Site Orders → Settings → Goodnotes sharing**.
2. Tap **Set up sharing**.
3. Enter a recognisable name, such as **Alex's iPad**, and tap **Create Shortcut key**.
4. Tap **Copy sharing key**. Save that copied value for the Authorization header
   in action 7 below. You can return to this open page and copy it again.

The copied value begins with `Bearer `, including a space. Paste the entire
value when asked. The key is displayed during this session; after reloading or
signing out, create a new key if you no longer have the copied value. Existing
keys listed here cannot be revealed again. Remove an unused key if you have
reached the five-key limit.

## 2. Create the shortcut

1. Open **Shortcuts**, tap **+**, and name your shortcut **New Site Order**.
2. Open its menu or info button, then **Details**. Enable **Show in Share Sheet**.
3. At the top of the shortcut, tap the accepted input types and select **PDFs**.
4. For **If there's no input**, choose **Stop and Respond**.

You will run the shortcut from Goodnotes' Share menu. Button positions and action
names can vary slightly between iPadOS versions.

## 3. Understand the two kinds of value in this guide

- **Text to type or paste** appears as `code`, such as `Authorization` or `openUrl`.
- **Variables** come from another action. To select one, tap the action's input,
  choose **Select Variable** or **Select Magic Variable**, and tap the output of
  the required earlier action. Shortcuts fills in that value when it runs.

For example, selecting the output of **Get Name** gives the current PDF's file
name. Typing the word “Name” would send that word as the file name.

## 4. Add these nine actions in order

Use the action search in Shortcuts to add each action below. These are built-in
Apple actions; an additional Actions app or UUID generator is unnecessary.

### Action 1 — Get Name

- Add **Get Name**.
- Select **Shortcut Input** as its input.
- Keep the `.pdf` extension. The result should look like `Gate drawing.pdf`.

### Action 2 — Base64 Encode

- Add **Base64 Encode** and choose **Encode**.
- Select **Shortcut Input**, the original PDF, as its input.
- Open the action's options and set **Line Breaks → None**.

Check this input carefully: Shortcuts may automatically use the preceding Name
result. Tap that value and select **Shortcut Input** so it encodes the PDF.

### Action 3 — Date / Current Date

Search for **Date**, add the action, and leave it set to **Current Date**.

### Action 4 — Format Date

- Add **Format Date**.
- Select the **Date** output from action 3.
- Set **Date Format → Custom**.
- Paste this into the custom format field, preserving the letter case:

```text
yyyyMMddHHmmssSSS
```

**Copy date format** in Site Orders Settings copies this exact value.

### Action 5 — Random Number

Add **Random Number** and set:

| Setting | Number to enter |
| --- | --- |
| Minimum | `100000000` |
| Maximum | `999999999` |

### Action 6 — Text

Add **Text**, then build its content in this order:

1. Insert the **Formatted Date** variable from action 4.
2. Type one hyphen: `-`.
3. Insert the **Random Number** variable from action 5.

The Text action will contain two variable blocks with a hyphen between them.
When it runs, the result will look like `20261105103000123-123456789`. This gives
this particular share a reference that can be reused if its request is retried.

### Action 7 — Get Contents of URL

Add **Get Contents of URL**. Paste this into its URL field:

```text
https://panelstock-reports.matthewlakerdis.workers.dev/order-share/import
```

**Copy upload URL** in Site Orders Settings copies this exact address.

Tap the action's arrow or **Show More** to reveal its options. Set:

| Setting | Value |
| --- | --- |
| Method | **POST** |
| Request Body | **JSON** |

Under **Headers**, add one text field. Tap **Copy key for this header** in the
Site Orders guide immediately before pasting the value. This copies the key
again after the date-format and URL copy steps:

| Header name — type this | Value — paste this |
| --- | --- |
| `Authorization` | The entire value from **Copy sharing key**, beginning with `Bearer ` |

Under the **JSON request body**, add these three fields. Select **Text** as the
field type for every row, then choose the indicated variable as its value:

| Field name — type this | Field type | Value — select this variable |
| --- | --- | --- |
| `id` | Text | **Text** output from action 6 |
| `name` | Text | **Name** output from action 1 |
| `data` | Text | **Base64 Encoded** output from action 2 |

The selected values should appear as variable blocks. This passes the current
PDF and its name each time the shortcut runs.

### Action 8 — Get Dictionary Value

- Add **Get Dictionary Value**.
- Type `openUrl` as its key, with a capital **U**.
- Select **Contents of URL** from action 7 as its dictionary input.

### Action 9 — If, with Open URLs and Show Alert inside it

Add **If**. Select **Dictionary Value** from action 8 as the input, and choose
**has any value** as the condition.

Place these actions between its markers:

```text
If Dictionary Value has any value
    Open URLs: Dictionary Value from action 8
Otherwise
    Show Alert: Contents of URL from action 7
End If
```

- Add **Open URLs** between **If** and **Otherwise**. Select **Dictionary Value**
  from action 8 as its input.
- Add **Show Alert** between **Otherwise** and **End If**. Select **Contents of
  URL** from action 7 as its message, so an error response can be read.
- Save the shortcut with **Done**.

## 5. Try one drawing from Goodnotes

1. In Goodnotes, open a drawing and use its Share or Export menu to export
   **one PDF up to 5 MB**.
2. In the iPad Share menu, scroll to the actions and tap **New Site Order**.
3. Allow the connection to PanelStock if asked.
4. Safari opens Site Orders. Sign in with the account that created this iPad's
   sharing key if prompted.
5. Check that the new draft contains the PDF under **Files and photos**.
6. Choose the project and order type, enter the items and requested delivery
   date, then submit when ready. Your account name and phone are prefilled.

The draft is also available in **My drafts** in the installed Site app. An
unfinished local order is saved separately before the shared draft opens.
Each new shortcut run starts a new draft; continue a previous one from My drafts.

The share creates a private draft. Submission uses the normal order workflow;
PDFs and JPG/PNG photos are appended after the order sheet in the emailed PDF.

## Troubleshooting

| What you see | What to check |
| --- | --- |
| New Site Order is missing from Share | Enable **Show in Share Sheet**, accept **PDFs**, export a PDF file from Goodnotes, and scroll down the Share menu's action list. |
| It stops when pressing Play in Shortcuts | Start from **Goodnotes → Share → New Site Order** so the shortcut receives the PDF. |
| Invalid PDF or file data | Action 2 must encode **Shortcut Input**, with **Line Breaks → None**. The JSON `data` field must use its **Base64 Encoded** output. Keep `.pdf` in the Name result and the file under 5 MB. |
| Invalid share identifier or missing fields | Check the exact field names `id`, `name`, `data`, each using **Text** as its field type and the variables listed in action 7. |
| Sharing key expired, removed or access changed | Create a new key and paste its entire **Bearer** value into the shortcut's **Authorization** header. Remove an unused key if you have reached the five-key limit. |
| Safari is signed into a different account | Sign in with the account that created the key. The uploaded draft will also be under **My drafts** in that account. |

## Keeping the shortcut working

- Each account can have **five** separately revocable iPad keys. Each key lasts
  **90 days**. When needed, create a new key and update the Authorization header.
- Keep a configured shortcut containing your key private. Each user creates
  their own key from their own account.
- **Remove** disconnects that iPad key while keeping existing drafts. Disabled
  accounts, PIN changes, Site app restrictions and revoked order-create access
  stop future imports.
- Normal account limits apply: **20 saved drafts**, a **5 MB** file limit, **60
  new upload attempts per account per hour**, and **60 requests per IP address
  per 15 minutes**. Retrying a successful request reference preserves its draft.
- A download, storage or current-draft save failure leaves the shared link and
  previous editor state available for retry. The shared PDF stays in My drafts.

There is no signed installer or iCloud installation link in this repository.
The guide describes manual setup directly on the iPad. Native Goodnotes and
Shortcuts prompts need a physical iPad check; browser tests verify the Site guide,
copy controls and draft handoff.

Apple's help: [Choose variables](https://support.apple.com/guide/shortcuts/apdd02c2780c/ios)
and [show a shortcut in Share](https://support.apple.com/guide/shortcuts/apd163eb9f95/ios).
