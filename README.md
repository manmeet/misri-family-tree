# Misri Family Tree Web App

This package is a static web app. It works with plain HTML, CSS, and JavaScript, so it can be hosted for free on GitHub Pages, Cloudflare Pages, or Netlify.

## Files

- `index.html`: the app
- `assets/app.js`: interaction, editing, search, import, export, pan, zoom
- `assets/style.css`: visual styling
- `data/family-data.json`: editable family tree data
- `data/family-data.js`: same data wrapped for browser use
- `data/original-transcription.json`: the original compiled transcription used to build the app

## Open locally

Double click `index.html`.

Everything runs in the browser. No install step is required.

## What family members can do

- Search for a person
- Click nodes for details
- Expand and collapse branches
- Pan and zoom around the tree
- Edit a person
- Add children
- Add spouses
- Add root people
- Add profile photos
- Export the updated JSON
- Import an updated JSON file

## Important update workflow

This static version does not write to a central server by itself. That is intentional because a public static site should not expose a write key to everyone.

Recommended simple family workflow:

1. Host the app.
2. Family members open the site and make edits in their browser.
3. They click **Export JSON**.
4. They send the exported JSON to the family tree maintainer.
5. The maintainer replaces `data/family-data.json` and `data/family-data.js` with the new version and republishes.

A more advanced shared-editing version can be connected to Firebase, Supabase, or another free database, but that requires account setup and security rules.

## Host free on GitHub Pages

1. Create a GitHub account.
2. Create a new repository, for example `misri-family-tree`.
3. Upload all files from this folder.
4. Go to repository Settings, then Pages.
5. Select Deploy from branch.
6. Choose the main branch and root folder.
7. Save, then share the published URL with family.

## Host free by drag and drop

Cloudflare Pages and Netlify can also host static files. Drag the folder or zip into their deploy interface and share the generated URL.

## Updating packaged data after an export

When someone exports an updated JSON from the app, copy the downloaded JSON into:

`data/family-data.json`

Then regenerate `data/family-data.js` using this small command:

```bash
python3 - <<'PY'
import json
from pathlib import Path
data = json.loads(Path("data/family-data.json").read_text())
Path("data/family-data.js").write_text("window.FAMILY_TREE_DATA = " + json.dumps(data, ensure_ascii=False) + ";\n")
PY
```

Commit or upload the updated files.

## Privacy note

A free static site is usually easy to share, but it may be public. Avoid adding private living-person details unless the family agrees on privacy rules.

