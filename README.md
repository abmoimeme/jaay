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
| Manager | Sales, returns, purchases, payments, expenses, items, reports, editing and deleting. No Setup |
| Cashier | New sales and quotes, payments received, customers, stock lookup |
| Stock keeper | Items, import, stock adjustments, purchase orders, goods received, suppliers |
| Accountant | Reads everything, including reports and exports. Cannot add, change or delete |

## Expenses (OpEx)

The **Expenses** page shows operating costs for this month, last month or this year: the total, the total against budget, the change from the previous period, and expenses as a share of sales. It also has a table by category, a monthly chart, and the list of expenses with a CSV export.

- **Recurring bills** (rent, salaries, Woyofal, Orange…) have an amount, a frequency (monthly, every 3 months or yearly) and a due day. Each period shows as due, paid or overdue. **Record payment** creates the expense for the oldest unpaid period. Home lists bills that are overdue or due within 7 days.
- **Budgets** are set per category, per month.
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

## Files

| File | Purpose |
| --- | --- |
| `index.html` | The app |
| `backend.js` | Firebase sign-in and data (with offline cache) |
| `config.js` | Firebase project settings and default store code |
| `firestore.rules` | Server-side security rules for the five levels |
| `logos/` | Store logos |

## Known limits

- Cost prices are hidden from cashiers in the app, but the rules do not hide them from the data a cashier can read.
- A forgotten password cannot be reset by the owner without a paid Firebase plan (Cloud Functions). Instead, the owner removes the person and adds them again with a new username; everyone can change their own password from the menu.
- Anyone can create a new store from the sign-in page. Before selling Jaay, put sign-ups behind an approval step.
