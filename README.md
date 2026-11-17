# Jaay — Billing and Inventory Management

Jaay is a billing, invoicing and stock app for parts shops, built first for Planet Auto Hub (Dakar). It runs in the browser on phones and computers, works on a weak connection, and syncs when the signal returns.

- Live site: https://abmoimeme.github.io/jaay/
- Backend: Firebase Authentication (email/password) + Cloud Firestore, on the free Spark plan
- Languages: English and French

## Sign-in and access levels

Staff sign in with a **store code** (for example `pah`), a **username** and a **password**. Access is enforced by Firestore security rules on Google's servers (`firestore.rules`), not only in the browser.

| Level | Can do |
| --- | --- |
| Owner | Everything, including Setup, staff, backup and restore |
| Manager | Sales, returns, purchases, payments, expenses and approving expense requests, items, reports, editing and deleting. No Setup |
| Cashier | New sales and quotes, payments received, customers, stock lookup, expense requests for approval |
| Stock keeper | Items, import, stock adjustments, purchase orders, goods received, suppliers |
| Accountant | Reads everything, including reports and exports. Cannot add, change or delete |

## Expenses (OpEx)

The **Expenses** page shows operating costs for this month, last month or this year: the total, the total against budget, the change from the previous period, and expenses as a share of sales. It also has a table by category, a monthly chart, and the list of expenses with a CSV export.

- **Recurring bills** (rent, salaries, Woyofal, Orange…) have an amount, a frequency (monthly, every 3 months or yearly) and a due day. Each period shows as due, paid or overdue. **Record payment** creates the expense for the oldest unpaid period. Home lists bills that are overdue or due within 7 days.
- **Budgets** are set per category, per month.
- **Expense requests:** a Cashier can enter an expense (for example fuel or supplies paid from the till). It goes to the Owner and Manager as a request, shown on Home and on Expenses with a count in the menu. They approve it or reject it with a reason, which the Cashier sees. Only approved expenses count in OpEx, budgets and profit. Day closing counts pending and approved cash out, because the money has left the drawer. The security rules only let a Cashier create expenses with status `pending`.
- **Capital transfers and remittances** are recorded, but they are not counted as an expense, in budgets or in net profit.
- Bills and budgets are in the `opex` collection. Only Owner, Manager and Accountant can read them, and only Owner and Manager can change them.

## Setup (one time)

1. Firebase console: create the project, enable **Authentication → Email/Password**, create **Firestore** in production mode (location `eur3`).
2. Register a web app and paste its `firebaseConfig` values into `config.js`.
3. **Firestore → Rules**: replace the rules with the contents of `firestore.rules` and **Publish**.
4. **Authentication → Settings → Authorized domains**: add `abmoimeme.github.io`.
5. GitHub: **Settings → Pages → Deploy from a branch → main / (root)**.
6. Open the site. The first visit to an unused store code offers **Create a store**; that person becomes the owner.
7. To bring in data from the earlier hosted version: there, **Setup → Download backup**; here, **Setup → Load a backup file**.

## Monitor (owner only)

The **Monitor** page shows who did what and when: per person (first and last activity, sales, payments in, expenses, edits, deletions) and a timeline you can filter by person, type and search, with CSV export. Today, yesterday, last 7 days or this month.

- Every change is saved in the same step as an entry in the `log` collection: person, access level, action, record, amount and the amount before an edit. Sign-ins, sign-outs and inactivity sign-outs are logged too.
- The security rules make the log trustworthy:
  - Only the owner can read it, and nobody can change or delete an entry.
  - The time must be Google's server time, and the name and access level must be the person's own.
  - A new record or change to an item, party, recurring bill/budget or transaction is refused unless it carries a new log entry by the same person, saved in the same step.
- Limit: deletions are logged by the app in the same step, but the rules cannot require it. Only the owner and managers can delete.

## User guide (Guide)

The **Guide** page (in the menu for every level, and under **More** on phones) is a French user guide with a **Caissier** tab and a **Gérant** tab. Cashiers see only their tab. It can be printed.

It stays current with the app in three ways:
- **Read from the app itself:** button and menu names come from the app's French translations, and the lists of what each level can do, each person's menu, expense categories and payment methods come from the app's settings. Renaming a button or adding a page or category updates the guide.
- **Update date:** "Mis à jour le" is the date of the last deploy.
- **Quoi de neuf:** add a line to `GUIDE_NEWS` in `index.html` with every change, and update the matching section when a workflow changes. `tools/qa_guide.py` fails if the guide names a button that has no French translation.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | The app |
| `backend.js` | Firebase sign-in and data (each tab keeps its own copy; offline changes are sent when the connection returns, while the page stays open) |
| `config.js` | Firebase project settings and default store code |
| `firestore.rules` | Server-side security rules for the five levels |
| `logos/` | Store logos |
| `brand/` | Jaay logo, app icons and favicon (indigo #1E2A5A, gold #F2A900, wordmark in Sora Bold) |
| `manifest.webmanifest` | Name, colours and icons used when the app is added to a phone's home screen |

## Known limits

- Cost prices are hidden from cashiers in the app, but the rules do not hide them from the data a cashier can read.
- A forgotten password cannot be reset by the owner without a paid Firebase plan (Cloud Functions). Instead, the owner removes the person and adds them again with a new username; everyone can change their own password from the menu.
- Anyone can create a new store from the sign-in page. Before selling Jaay, put sign-ups behind an approval step.
