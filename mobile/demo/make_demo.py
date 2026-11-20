# Sample data for the app reviewers' demo store (pahdemo). Everything here is invented.
# Run: python3 make_demo.py  ->  jaay-demo-backup.json, then load it with Setup > Backup and restore in the demo store.
import json, random, datetime
random.seed(2026)
today = datetime.date.today()
CATS = {'Filtres': [('Filtre à huile', 3500, 6000), ('Filtre à air', 4000, 7000), ('Filtre à carburant', 5000, 8500), ('Filtre habitacle', 4500, 7500)],
        'Freinage': [('Plaquettes de frein avant', 9000, 15000), ('Plaquettes de frein arrière', 8000, 13500), ('Disque de frein', 14000, 22000), ('Liquide de frein DOT4 500 ml', 2500, 4500)],
        'Moteur': [('Bougie d\'allumage', 1800, 3500), ('Courroie de distribution', 12000, 20000), ('Pompe à eau', 16000, 26000), ('Joint de culasse', 9000, 16000)],
        'Suspension': [('Amortisseur avant', 18000, 30000), ('Amortisseur arrière', 16000, 27000), ('Rotule de direction', 6000, 11000), ('Silentbloc', 2500, 5000)],
        'Électricité': [('Batterie 12V 60Ah', 32000, 48000), ('Alternateur', 45000, 70000), ('Ampoule H4', 1200, 2500), ('Démarreur', 40000, 62000)],
        'Lubrifiants': [('Huile moteur 5W30 4 L', 14000, 21000), ('Huile moteur 10W40 4 L', 11000, 17000), ('Liquide de refroidissement 4 L', 4000, 7000), ('Huile de boîte 1 L', 3500, 6000)]}
BRANDS = ['Toyota', 'Peugeot', 'Renault', 'Hyundai', 'Kia', 'Nissan']
items = {}; n = 0
for cat, rows in CATS.items():
    for name, cost, price in rows:
        for b in random.sample(BRANDS, 2 if n % 3 else 1):
            n += 1; items['d%03d' % n] = {'name': name + ' ' + b, 'sku': 'D%04d' % n, 'category': cat, 'brand': b, 'cost': cost, 'price': price, 'opening': random.randint(4, 30), 'min': 3}
parties = {'dc1': {'name': 'Garage Démo Liberté', 'segment': 'Mechanic', 'phone': '+221770000101'}, 'dc2': {'name': 'Taxi Démo Services', 'segment': 'Fleet', 'phone': '+221770000102'},
           'dc3': {'name': 'Awa Démo', 'segment': 'Retail', 'phone': '+221770000103'}, 'dc4': {'name': 'Atelier Démo Médina', 'segment': 'Mechanic', 'phone': '+221770000104'},
           'dc5': {'name': 'Transport Démo Sahel', 'segment': 'Fleet', 'phone': '+221770000105'}, 'ds1': {'name': 'Fournisseur Démo Pièces', 'segment': 'Supplier', 'phone': '+221770000201'},
           'ds2': {'name': 'Import Démo Auto', 'segment': 'Supplier', 'phone': '+221770000202'}}
txns = {}; ids = list(items); no = 0
def lines(k, buy=False):
    out = []
    for i in random.sample(ids, k):
        it = items[i]; q = random.randint(4, 12) if buy else random.randint(1, 3)
        out.append({'itemId': i, 'name': it['name'], 'qty': q, 'price': it['cost'] if buy else it['price'], 'cost': it['cost']})
    return out
for day in range(24, -1, -1):
    d = (today - datetime.timedelta(days=day)).isoformat()
    for _ in range(random.randint(0, 2) + (1 if day < 3 else 0)):
        no += 1; L = lines(random.randint(1, 3)); sub = sum(l['qty'] * l['price'] for l in L); cogs = sum(l['qty'] * l['cost'] for l in L)
        cust = random.choice(['dc1', 'dc2', 'dc3', 'dc4', 'dc5', '']); credit = cust in ('dc1', 'dc5') and random.random() < 0.35
        txns['dt%03d' % no] = {'type': 'sale', 'no': 'DEMO-%04d' % no, 'date': d, 'partyId': cust, 'lines': L, 'sub': sub, 'taxAmt': 0, 'cogs': cogs, 'total': sub, 'paid': 0 if credit else sub,
                               'method': random.choice(['Cash', 'Wave', 'Orange Money']), 'note': '', 'createdAt': int(datetime.datetime.fromisoformat(d + 'T10:00:00').timestamp() * 1000) + no}
    if day in (20, 9):
        no += 1; L = lines(5, True); sub = sum(l['qty'] * l['price'] for l in L)
        txns['dt%03d' % no] = {'type': 'purchase', 'no': 'DEMO-P%03d' % no, 'date': d, 'partyId': random.choice(['ds1', 'ds2']), 'lines': L, 'sub': sub, 'taxAmt': 0, 'cogs': 0, 'total': sub, 'paid': sub, 'method': 'Cash', 'note': '',
                               'createdAt': int(datetime.datetime.fromisoformat(d + 'T09:00:00').timestamp() * 1000) + no}
out = {'app': 'jaay', 'version': 1, 'exportedAt': datetime.datetime.utcnow().isoformat() + 'Z', 'storeId': 'pahdemo',
       'store': {'name': 'Demo Auto Parts (sample data)', 'address': 'Sample address, Dakar', 'phone': '+221 77 000 01 00', 'currency': 'FCFA', 'taxRate': 0, 'invPrefix': 'DEMO', 'color': '#1E2A5A', 'footer': 'Sample data for app review. Not a real business.'},
       'items': items, 'parties': parties, 'txns': txns}
json.dump(out, open('jaay-demo-backup.json', 'w'), ensure_ascii=False, indent=1)
print(len(items), 'items,', len(parties), 'parties,', len(txns), 'documents')
