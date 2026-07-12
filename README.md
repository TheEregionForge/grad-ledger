# GradLedger

![Version](https://img.shields.io/badge/version-0.5.1-2563eb)
![Chrome](https://img.shields.io/badge/Chrome-extension-34a853)
![TypeScript](https://img.shields.io/badge/built%20with-TypeScript-3178c6)
![Local first](https://img.shields.io/badge/data-local--first-7c3aed)

> A small, local-first Chrome extension for collecting professor, lab, and graduate-program information while you browse university websites.

Persian guide: [README.fa.md](README.fa.md)

## 🧭 Contents

- [What GradLedger does](#what-gradledger-does)
- [Install from the student release](#install-student-release)
- [Quick start](#quick-start)
- [Current capabilities](#current-capabilities)
- [Limitations](#limitations)
- [Privacy and cautions](#privacy-cautions)
- [For developers](#for-developers)

<a id="what-gradledger-does"></a>
## 🎓 What GradLedger does

GradLedger turns information spread across academic websites into a structured record that you can review and save. It is designed for students comparing supervisors, labs, and programs.

The extension uses deterministic rules and page structure. It does not send pages to an AI service or require an account.

<a id="install-student-release"></a>
## 📦 Install from the student release

1. Download `gradledger-0.5.1.zip` from the GitHub Release.
2. Extract the ZIP file to a normal folder. Keep that folder in place; Chrome loads the extension from it.
3. Open `chrome://extensions` in Chrome.
4. Turn on **Developer mode** in the top-right corner.
5. Click **Load unpacked**.
6. Select the extracted folder containing `manifest.json`.
7. Pin **GradLedger** from the puzzle-piece Extensions menu.

The ZIP is not installed by double-clicking. Chrome needs the extracted folder through **Load unpacked**.

<a id="quick-start"></a>
## 🚀 Quick start

1. Open a professor, lab, or graduate-program webpage.
2. Click the GradLedger toolbar icon.
3. Grant access to the site when Chrome asks. This lets the extension read the page you selected.
4. Click **Start capture**. The first page is analyzed immediately.
5. Browse other pages from the same website. GradLedger captures matching pages as you visit them, including pages opened in new tabs.
6. Review the evidence and confidence shown for each field.
7. Click **Save report** to keep one professor/program in the local report list, or **Download report** for a CSV file.
8. When finished with that person or program, click **Stop session** and start a new capture.

Saved reports stay in Chrome’s local extension storage. Use the Reports view to download all saved records together as one CSV file.

<a id="current-capabilities"></a>
## ✨ Current capabilities

- Classifies pages as professor, graduate program, lab, scholarship, faculty directory, or unknown.
- Extracts names, academic titles, universities, countries, departments, emails, research interests, contact instructions, subject-line hints, and open-position evidence.
- Recognizes positive and negative recruiting statements, such as “accepting PhD students” and “not currently taking on any new students.”
- Handles common obfuscated emails such as `name [at] university [dot] edu` and ignores obvious placeholder emails.
- Captures same-site pages during an active session and merges new evidence into the existing record.
- Keeps evidence snippets and confidence scores so uncertain fields can be checked.
- Saves data locally and exports student-friendly CSV reports.
- Automatically checks for updates released on Github repository


<a id="limitations"></a>
## 🧩 Limitations

- Extraction is rule-based, so unusual wording, image-only text, heavy JavaScript applications, PDFs, login pages, and blocked pages may produce incomplete results.
- A page that merely lists current students is not treated as proof of an open position. When the site gives no explicit recruiting statement, the status may remain unknown.
- University recognition is strongest for known institutions and common naming patterns. Review the university and country before contacting anyone.
- Capture is limited to the same site pattern as the session’s starting page. External links are not collected.
- The extension does not submit applications, send emails, or replace the university’s official admissions information.

<a id="privacy-cautions"></a>
## 🔒 Privacy and cautions

GradLedger is local-first, but Chrome permissions still matter. Grant access only when you want the extension to read a site. Review extracted email addresses, deadlines, funding claims, and open-position status before using them.

Do not treat an extracted record as an admissions decision. Always confirm requirements, deadlines, funding, and supervisor availability on the official university page. Avoid using the extension on private, authenticated, or sensitive pages.

<a id="for-developers"></a>
## 🛠️ For developers

Requirements: Node.js and npm.

```powershell
npm install
npm test
npm run build
```

The main public files are the source code, tests, package files, README guides, release notes, and [LICENSE](LICENSE).
