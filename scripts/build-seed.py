#!/usr/bin/env python3
"""Build src/data/items.json from BAR_Reports.xlsx plus items transcribed by hand
from the scanned PDF (no text layer). Run: python3 -I scripts/build-seed.py <path-to-BAR_Reports.xlsx>
(the xlsx path is required; the file is user data and is not kept in the repo)

Sources:
  - PDF pages 2-5 (Bar Report, "Size OZ" column) -> PDF_BAR below
  - PDF page 1 (Store Requisition, real item codes) -> PDF_REQ below
  - Excel sheets "Bar Report - BC", "LIQUEUR REPORT", "Store Issue List" fill gaps.
Category headings are the known lists below (taken from the PDF page headings
and the Excel category rows; Excel item rows are also column-A only, so
"only column A filled" cannot identify categories).

Correcting bottle sizes: put them in SIZE_OVERRIDES below, never edit items.json by
hand. Overrides are applied after PDF sizes and the default, so they survive every
regeneration. Keys are the generated item code ("B012") or the normalised item name
(see norm(): lower-case ascii letters/digits only, e.g. "johnniewalkerblack").
Changing a size after real data exists shifts historical stock by bottles x change.
"""
import json, os, re, sys, warnings

warnings.filterwarnings('ignore')
import openpyxl

if len(sys.argv) != 2:
    print('usage: python3 -I scripts/build-seed.py <path-to-BAR_Reports.xlsx>', file=sys.stderr)
    sys.exit(2)
XLSX = sys.argv[1]
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'src', 'data', 'items.json')
DEFAULT_SIZE = 23

# Verified size corrections (oz per bottle). Key: item code ("B012") or norm(name).
SIZE_OVERRIDES: dict[str, float] = {}


def norm(s):
    s = s.encode('ascii', 'ignore').decode().lower()
    return re.sub(r'[^a-z0-9]', '', s)


# ---------------- PDF Bar Report (name, size or None when blank on the scan) ----
def sec(cat, size, names):
    return [(cat, n, size) for n in names]

PDF_BAR = (
    sec('APERITIFS', 25, ['CAMPARI'])
    + sec('APERITIFS', 23, ['FERNET BRANCA'])
    + sec('APERITIFS', 33, ['MARTINI BIANCO', 'MARTINI EXTRA', 'MARTINI ROSSO'])
    + sec('APERITIFS', 23, ['PIMM S NO.1', 'RICARD'])
    + sec('BOURBON', 23, ['EARLY TIME', "JACK DANIEL'S", 'JIM BEAM'])
    + sec('COGNAC', 23, ['HENNESSY V.S.O.P', 'REMY MARTIN V.S.O.P.', 'REMY MARTIN XO'])
    + sec('GIN', 23, ['GILLBEY GIN'])
    + sec('GIN', 25, ['BEEFEATER', 'BOMBAY SAPPHIRE'])
    + sec('GIN', 23, ['GORDON', 'HENDRICK S'])
    + sec('GIN', 16, ['MONKEY 47'])
    + sec('GIN', 23, ['SANEHA THAI'])
    + sec('GIN', 25, ['TANQUERAY'])
    + sec('GIN', 23, ['UNCLE TOM GIN'])
    + sec('LIQUEUR', 23, [
        'AMARETTO', 'APEROL', 'BAILEY S CREAM', 'BENEDICTINE DOM', 'COINTREAU', 'KAHLUA',
        'MALIBU', 'MIDORI MELON', 'MOOZE MINT GREEN', 'SAMBUCA MATTI WHITE',
        'UNCLE PLOY BANANA', 'UNCLE PLOY BLUE', 'UNCLE PLOY CHERRY', 'UNCLE PLOY COCONUT',
        'UNCLE PLOY LYCHEE', 'UNCLE PLOY MELON', 'UNCLE PLOY ORANGE', 'UNCLE PLOY PEACH',
        'UNCLE PLOY STRAWBERRY', 'UNCLE PLOY TRIPLE SEC',
        'PHOENIX BLUE', 'PHOENIX BANANA', 'PHOENIX ORANGE', 'PHOENIX STRAWBERRY',
        'PHOENIX TRIPLE SEC'])
    + sec('PORT & CHERRY', 25, ["TAYLOR'S", 'TRIO PEPE'])
    + sec('RUM', 23, ['CACHACA CANARIO BRAZIL'])
    + sec('RUM', 25, ['BACARDI CARTA ORO', 'BACARDI WHITE', 'CAPTAIN MORGAN WHITE',
                      'CAPTAIN MORGAN DARK', 'RUM DARK'])
    + sec('RUM', 23, ['RUM PHRAYA GOLD', 'UNCLE TOM RUM', 'RUM PHRAYA ELEMENT'])
    + sec('SCOTCH WHISKY', 23, ['BALLANTINE 17 YRS.', 'BALLANTINE FINEST', 'CHIVAS REGAL',
                                'FAMOUS GROUSE', 'GLENFIDDICH 12 YEAR'])
    + sec('SCOTCH WHISKY', 25, ['GLENLIVET 12 YRS.'])
    + sec('SCOTCH WHISKY', 23, ['GLENMORANGIE 10 Y.', 'JOHN JAMESON', 'JW BLACK LABEL',
                                'JW RED LABEL', 'MACALLAN 12 Y'])
    + sec('SCOTCH WHISKY', 25, ['JW BLUE LABEL'])
    + sec('EAU DE VIE / TEQUILA', 23, ['CALVADOS', 'GRAPPA', 'LIMONCELLO', 'TEQUILA MATADOR',
                                       'TEQUILA SIERRA', 'UNCLE JANGO TEQUILA'])
    + sec('EAU DE VIE / TEQUILA', 8, ['SANGRIA COCKTAIL(G.)'])
    + sec('THAI WHISKY', 23, ['MAEKHONG', 'SANG SOM'])
    + sec('VODKA', 23, ['UNCLE TOM VODKA', 'ABSOLUTE', 'VODKA GILLBEY', 'VODKA BELVEDERE',
                        'VODKA CIROC', 'VODKA SMIRNOFF'])
    + sec('SPARKLING WINE', 25, ['LE CHALET BRUT', 'FLEUR DE FRANCE BLANC', 'SATORI PROSECCO BRUT'])
    + sec('RED WINE', 25, ['GATO 9LIVES CABERNET', 'BABICH PINOT', 'CA VINI CAVIENEL ROSSO',
                           'SHELL BAY SHIRAZ', 'DUBOEUF CABERNET', 'COLINA CABERNET',
                           'PINICAL SHIRAZ', 'ESSENCIEL PARADIS ROSE'])
    + sec('WHITE WINE', 25, ['GATO 9LIVES SAUVIGNON', 'BABICH SAUVIGNON', 'CA VINI CAVIENEL BIANCO',
                             'SHELL BAY CHARDONNAY', 'DUBOEUF CHARDONNAY', 'COLINA CHARDONNAY',
                             'PINICAL CHARDONNAY'])
    + sec('BEER', None, ['HEINEKEN 0% BTL', 'CORONA EXTRA BTL.', 'HEINEKEN BTL.', 'HEINEKEN CAN',
                         'BUDWEISER BEER BTL.', 'CHANG CAN', 'CHANG SMALL BTL.', 'BEER SINGHA CAN',
                         'SINGHA SMALL BTL.', 'TIGER BTL.', 'ASAHI (BTL.)', 'KIRIN (BTL.)', 'CHANG/D'])
    + sec('SOFT DRINK', None, ['COKE BTL.', 'COKE CAN', 'COKE LIGHT CAN', 'COKE ZERO CAN',
                               'FANTA CAN', 'GINGER ALE CAN', 'PURRA WATER', 'SAN PELLEGRINO 50 CL',
                               'SODA BTL', 'SPRITE BTL.', 'SPRITE CAN', 'TONIC CAN', 'WELLE WATER',
                               'RED BULL CAN'])
    + sec('FROZEN', 63, ['BANANA', 'BLUE RASPBERRY', 'MANGO', 'MARGARITA', 'STRAWBERRY'])
    + sec('MONIN (SOFT DRINK)', 23, [
        'Monin Fleur Flower', 'Monin Green Apple', 'Monin Lychee', 'Monin Mangu-Mango',
        'Monin Passion Fruit', 'Monin Strawberry', 'Monin Vanilla', 'Monin Pink Grapefruit',
        'Monin Peach', 'Monin Raspberry', 'Monin Blue Lychee', 'Monin Coconut', 'Monin Caramel',
        'Monin Cucumber', 'Monin Yuza Orange', 'Monin Lavender', 'Monin Roasted Hazelnut',
        'Monin Rose Syrup'])
    + sec('COFFEE & TEA', None, ['Cafe Crema Catering Beans(25)', 'Dilmah Ceylon Tea (100)'])
)

# Excel-name -> PDF-name aliases (normalised) so the same product is not listed twice
BAR_ALIAS = {
    'JOHNNIE WALKER BLACK': 'JW BLACK LABEL', 'JOHNIE WALKER BLACK': 'JW BLACK LABEL',
    'JOHNNIE WALKER RED': 'JW RED LABEL', 'JOHNIE WALKER RED': 'JW RED LABEL',
    "BALLANTINE'S": 'BALLANTINE FINEST', "GORDON'S GIN": 'GORDON', 'BOMBAY': 'BOMBAY SAPPHIRE',
    'ABSOLUT': 'ABSOLUTE', 'SMIRNOFF': 'VODKA SMIRNOFF', 'BACARDI': 'BACARDI WHITE',
    'BACARDI LIGHT': 'BACARDI WHITE', 'DARK RUM': 'RUM DARK', 'MAE KHONG': 'MAEKHONG',
    "BAILEY'S IRISH": 'BAILEY S CREAM', "BAILEY'S IRISH CREAM": 'BAILEY S CREAM',
    "PIMM'S": 'PIMM S NO.1', 'MARTINI BLANCO': 'MARTINI BIANCO',
    'MARTINI VERMOUTH (R)': 'MARTINI ROSSO', 'MARTINI VERMOUTH (W)': 'MARTINI EXTRA',
    'CREME DE BANANA': 'UNCLE PLOY BANANA', 'CREME DE BANANAS': 'UNCLE PLOY BANANA',
    'BLUE CURACAO': 'UNCLE PLOY BLUE', 'ORANGE CURACAO': 'UNCLE PLOY ORANGE',
    'TRIPLE SEC': 'UNCLE PLOY TRIPLE SEC', 'CHERRY BRANDY': 'UNCLE PLOY CHERRY',
    'COKE': 'COKE BTL.', 'SODA WATER': 'SODA BTL', 'TONIC WATER': 'TONIC CAN',
    'GINGER ALE': 'GINGER ALE CAN', 'DIET COKE': 'COKE LIGHT CAN', 'SPRITE': 'SPRITE BTL.',
    'SAN PELLEGRINO': 'SAN PELLEGRINO 50 CL', 'HEINEKEN': 'HEINEKEN BTL.',
    'SINGHA': 'SINGHA SMALL BTL.', 'TIGER': 'TIGER BTL.', 'CORONA': 'CORONA EXTRA BTL.',
    'SAMBUCA': 'SAMBUCA MATTI WHITE', 'MELON MIDORI': 'MIDORI MELON',
    'GLENMORANGIE': 'GLENMORANGIE 10 Y.', 'FANTA ORANGE': 'FANTA CAN',
    'CRÈME DE MENTHE': 'MOOZE MINT GREEN', 'HENNESSY V.S. O. P.': 'HENNESSY V.S.O.P', 'REMY MARTIN V.S.O.P.': 'REMY MARTIN V.S.O.P.',
}

EXCEL_BAR_CATS = {
    'APERITIFS', 'SCOTCH WHISKY', 'BOURBONS', 'IRISH WHISKY', 'THAI WHISKY', 'GIN', 'VODKA',
    'RUM', 'COGNAC', 'EAU DE VIE', 'LIQUEUR', 'OTHER', 'BEER', 'SOFT DRINK', 'FROZEN',
    'HOUSE WINE', 'PREMIUM WINE', 'PREMIUM HOUSE WINE', 'SPARKLING WINE', 'PORT & CHERRY',
}
CAT_RENAME = {'BOURBONS': 'BOURBON', 'EAU DE VIE': 'EAU DE VIE / TEQUILA'}
# Excel rows that are form chrome / ambiguous placeholders rather than items
EXCEL_SKIP = {'BAR REPORT', 'ITEM', 'BTL.', 'OZ', 'OTHER'}


def excel_bar_items(wb):
    out = []  # (category, name)
    for sheet in ['Bar Report - BC', 'LIQUEUR REPORT']:
        cat = None
        for row in wb[sheet].iter_rows(min_col=1, max_col=1, values_only=True):
            v = row[0]
            if not isinstance(v, str):
                continue
            t = v.strip()
            if not t or t.startswith('DATE') or t.upper() in EXCEL_SKIP:
                continue
            if t.upper() in EXCEL_BAR_CATS:
                cat = CAT_RENAME.get(t.upper(), t.upper())
                continue
            if cat is None:
                continue
            out.append((cat, t))
    return out


# ---------------- PDF page 1 Store Requisition (code, name) ---------------------
def rows(cat, text):
    res = []
    for line in text.strip().splitlines():
        code, name = line.strip().split(None, 1)
        res.append((code, name.strip(), cat))
    return res

PDF_REQ = (
    rows('Beverage', """
20000001 Campari
20000004 Fernet Branca
20000005 Martini Bianco
20000007 Martini Rosso
20000006 Martini Extra Dry
20000010 Ricard
20500003 Haervey Bristol Cream
20500001 Port taylor
20500002 Trio Pepe
20700003 Ballantine 17 Yrs.
20100001 Benmark
20700005 Chivas Regal
20700006 Famous Grouse
20700007 Glenfiddich 12 Y
20700009 Grenmorangie
20100002 Jack Danial
20100003 Jim Beam
20700010 John Jameson
20700011 JW Black Lable
20700012 JW Red Lable
20900002 Mekhong Large
20900003 Sang Som
20300023 Gin Bombay
20300002 Gin Beefeater
20300001 Gin Barton
20300013 Uncle Tom Gin
21000003 Vodka Absolute
21000002 Uncle Tom Vodka
21000007 Vodka Smirnoff
21000004 Vodka Barton
20600005 Rum Bacardi White
20600008 Rum Dark
20600006 Rum Barton
20600012 Rum Uncle Tom
20000003 Copa De Oro Btl.75 cl.
20200003 Hennessy X.O
20200002 Hennessy V.S.O.P
20200004 Remy Martin V.S.O.P.
20800001 Calvados
20800006 Tequila Matador
20800009 Uncle Jango Tequila
24000026 Grenadine Blue
24000028 Grenadine Syrup
24000031 Juice Lime Jumbo A
20400030 Uncle Ploy Banana
20400032 Uncle Ploy Cherry
20400031 Uncle Ploy Blue curacao
20400035 Uncle Ploy Lychee Liqueur
20400062 Cream De Cassis
20400039 Uncle Ploy Strawberry
20400036 Uncle Ploy Melon
20400037 Uncle Ploy Orange Curacao
20400038 Uncle Ploy Peach Liqueur
20400014 Crème de mint green
20400017 Kahlua
20400018 Malibu
20400019 Midori Melon
20400029 Sambuca
20400041 Uncle Ploy Triple Sec
23000008 Beer Singha (Btl)
23000007 Beer Singha (Can)
23000006 Beer Chang (Btl)
23000004 Beer Chang (Can)
23100006 Beer Heineken (Btl)
23100007 Beer Heineken (Can)
23000009 Beer Tiger (Btl)
23100005 Beer Corona Extra
24000004 Coke (Btl)
24000005 Coke (Can)
24000006 Coke light (Can)
24000007 Coke Zero (Can)
24000023 Ginger Ale (Can)
24000016 Fanta Orange (Can)
24000049 San Pellegrino/ S
24000053 Soda Rock Mountain Btl.
24000055 Sprite (Btl)
24000056 Sprite (Can)
24000061 Tonic Water (Can)
24000014 Drinking Water Gallon
24000047 Purra water
20400011 Benedictine DOM
24000003 Caramel Salted
20400010 Baileys Cream
20400013 Cointreau
20400064 Aperol
20400007 Amaretto Cristiani
24000002 Café crema catering Bean
""")
    + rows('Wine', """
25300003 Allegre brut
25100015 Colina Carb SVG
25000011 Colina Chardonnay
25000009 Shell Bay Chardonnay
25100011 Shell Bay Shiraz Cab
25000005 Gato Negro SVG
25100004 Gato Negro Cab SVG
25000006 Babich SVG
25100009 Babich Pinot noir
25300009 Satori Prosecco
25000014 Sartori Pinot Grigio
25100017 Duboeuf Syrah Rose
25000012 Duboeuf Chardonnay
25100016 Duboeuf Cab SVG
25000010 Elfo Chardonnay Salento
25100013 Elfo Primitivo Salento
25300007 Moet Chandon Brut
""")
    + rows('Frozen', """
24100001 Banana Frozen
24100002 Blue Raspberry Frozen
24100003 Cappuccino Frozen
24100008 Mocha Cappuccino Frozen
24100006 Magarita Frozen
24100004 Mango Frozen
24100013 Strawberry Frozen
24100007 Mixed Berry
24000038 Passion Fruit
""")
    + rows('Monin', """
24000036 Monin Lychee
24000035 Monin Green Apple
24000039 Monin Strawberry
24000040 Monin Vanilla
24000038 Monin Passion Fruit
24000087 Monin Pink Grapefruit
24000034 Monin Fleur Flower
24000037 Monin Mango
""")
    + rows('Fruit Juice', """
16800035 Orange Juice
16800034 Pineapple Juice
16800031 Lemon Juice
16800027 Apple Juice
16800030 Guava Juice
16800039 Lychee Juice
16800023 Rosella Juice
16800041 Ocean spray Cranberry Juice
""")
    + rows('Food', """
16800046 UFC mango Juice
16800042 Tomato Fruit Juice
16800039 Juice Lychee Chaba
16800037 Juice Coconut น้ำกะทิกล่อง
16800043 Tropica King มะพร้าวพร้อมปั่น
16800044 Tropica King มะม่วงน้ำดอกไม้
18900003 High Frucetose
18900005 Honey Syrup น้ำผึ้งจากดอกสาบเสือ
18800028 Sauce Lea / Perrins
18800038 Sauce Tabasco
16800045 Tropica King สตรอเบอร์รี่
15200009 Olive Stuff มะกอกเขียวไส้พริก
18900016 Sugar White Sachet
18900009 Sugar Brown Sachet
18900002 Birdwing Cream
16300003 Falcon นกเหยี่ยวชนิดข้นจืด
18800022 Salt Prung Thip
19100006 Prinles potato มันฝรั่งทอดกรอบ
""")
    + rows('General', """
34000040 Rubbish 30x40
34300065 Cocktail Stick
34000004 Blue Gel เจลทำความสะอาดมือ
34000008 สบู่เหลวล้างมือกลิ่นโอเชียน
34300043 Paper Napkin brown Logo
34300046 Plastic Bag 20 X 30 ถุงเย็น
34300066 Wood Stir ไม้คนเหล้าโลโก้
34300059 Straw BIO RECO 6*210 mm
34000042 Scoth Brite 2หน้า3m
34300053 Plastic Rope เชือกฟาง
34000009 22 Multi-Quat
34000024 Super Trump
34000022 Rinse Dry Extra Gallon
34000017 Neo Liquid
34000019 Oasis Compac 10
34000030 Lemon liquid น้ำยาล้างจาน
34300023 แก้วพลาสติก 16 ออนซ์
34300022 ฝาโดม 16 ออนซ์
34300021 ถ้วยกาแฟ 8 ออนซ์
34300020 ฝากาแฟ 8 ออนซ์
33000002 Book No.5 มุมมัน(ปกแข็งหนา)
34300010 Candle Light box/ 60pack
33000027 Pen Wyteboard - Blue
33000021 Pen Blue
34000005 Broom ไม้กวาด
34100038 Scott Tissues ทิชชูพนักงาน
32000160 Transfer Report
34300026 Latax Gloves (L)
34300027 Latax Gloves (M)
34300028 Latax Gloves (S)
""")
)

REQ_ALIAS = {
    'Jim Bream': 'Jim Beam', 'Jack Daniel': 'Jack Danial', 'Glenmorangie': 'Grenmorangie',
    'Bombay': 'Gin Bombay', 'Amaretto': 'Amaretto Cristiani',
    'Beer Heineken': 'Beer Heineken (Btl)', 'Beer Singha': 'Beer Singha (Btl)',
    'Beer Chang': 'Beer Chang (Btl)', 'Beer Tiger': 'Beer Tiger (Btl)', 'Coke': 'Coke (Btl)',
    'Ginger Ale': 'Ginger Ale (Can)', 'Sprite': 'Sprite (Btl)', 'Tonic Water': 'Tonic Water (Can)',
    'Fanta orange': 'Fanta Orange (Can)', 'San Pellegrino': 'San Pellegrino/ S',
    'Juice Lime': 'Juice Lime Jumbo A', 'Margarita Frozen': 'Magarita Frozen',
    'Rosela juice': 'Rosella Juice', 'Cranberry Juice Cocktail': 'Ocean spray Cranberry Juice',
    'Sauce Lea & Perrins': 'Sauce Lea / Perrins', 'Honey Sabsua': 'Honey Syrup',
    'Oilve Stuff': 'Olive Stuff', 'Scoth Brite': 'Scoth Brite 2',
    'Crème de Banana': 'Uncle Ploy Banana', 'Blue Curacao': 'Uncle Ploy Blue curacao',
    'Orange Curacao': 'Uncle Ploy Orange Curacao', 'Triple Sec': 'Uncle Ploy Triple Sec',
    'Cream De Menth Green': 'Crème de mint green', 'Malibu': 'Malibu',
    'Mumm': 'Mumm', 'Coffee Bean Aroma': 'Café crema catering Bean',
    'Rum Pirates': 'Rum Pirates', 'Pimm\'s No. 1': "Pimm's No. 1",
    'Juice Lychee 8 oz.': 'Juice Lychee Chaba', 'Juice Coconut 400 ml.': 'Juice Coconut',
    'Orange juice': 'Orange Juice', 'Pineapple juice': 'Pineapple Juice', 'Lemon juice': 'Lemon Juice',
    'Apple juice': 'Apple Juice', 'Guava juice': 'Guava Juice', 'Lychee juice': 'Lychee Juice',
    'Juice Mango 8 oz.': 'UFC mango Juice', 'Juice Tomato 43 oz.': 'Tomato Fruit Juice',
    'Remy Martin V.S.O.P.': 'Remy Martin V.S.O.P.', 'Hennessy V.S.O.P.': 'Hennessy V.S.O.P',
    'Hennessy X.O.': 'Hennessy X.O', 'Latax Gloves': 'Latax Gloves (L)',
    'Straw': 'Straw BIO RECO 6*210 mm', 'Stir': 'Wood Stir',
    'Paper Napkin (pack)': 'Paper Napkin brown Logo', 'Candle Light': 'Candle Light box/ 60pack',
    'Rubbish Bag 36x45 s/w': 'Rubbish 30x40', 'Klean Lemon Extra': 'Lemon liquid',
    'Rinse Dry อบแห้ง': 'Rinse Dry Extra Gallon', 'Pen - Blue': 'Pen Blue',
    'Mekhong Large': 'Mekhong Large', 'Taittinger / S': 'Taittinger / S',
}


def excel_req_items(wb):
    ws = wb['Store Issue List']
    sec_name = None
    out = []  # (code, name, category)
    for r in ws.iter_rows(min_row=4, max_col=9, values_only=True):
        first = r[0]
        if isinstance(first, str) and first.strip().upper() in ('BEVERAGE STORE', 'FOOD STORE', 'GENERAL STORE'):
            sec_name = first.strip().split()[0].capitalize()
            continue
        if sec_name is None or (isinstance(first, str) and first.startswith('Requested')):
            continue
        for c in (0, 3, 6):
            code, name = r[c], r[c + 1]
            if code is None or not isinstance(name, str) or not name.strip():
                continue
            out.append((str(code).strip(), name.strip(), sec_name))
    return out


def main():
    wb = openpyxl.load_workbook(XLSX, data_only=True)
    items = []
    defaulted = []

    # ---- bar items
    seen = set()
    bar = []
    for cat, name, size in PDF_BAR:
        k = norm(name)
        if k in seen:
            continue
        seen.add(k)
        bar.append([cat, name, size])
    dropped = []
    kept = []  # Excel-only rows: [cat, name]
    excel_seen = set()
    for cat, name in excel_bar_items(wb):
        tgt = BAR_ALIAS.get(name.upper().strip(), name)
        if norm(tgt) in seen:
            dropped.append('%s [%s] duplicates PDF item "%s"' % (name, cat, tgt))
            continue
        k = norm(name)
        if (cat, k) in excel_seen:
            dropped.append('%s [%s] repeated Excel row (other sheet)' % (name, cat))
            continue
        excel_seen.add((cat, k))
        kept.append([cat, name])
    # Same name in different categories (CONTESSA gin/vodka/rum, HOUSE vs PREMIUM
    # WINE) is a different product: keep, but make the name unique with its category.
    cats_by_name = {}
    for cat, name in kept:
        cats_by_name.setdefault(norm(name), set()).add(cat)
    for cat, name in kept:
        if len(cats_by_name[norm(name)]) > 1:
            name = '%s (%s)' % (name, cat.title())
        bar.append([cat, name, None])
    for n, (cat, name, size) in enumerate(bar, 1):
        if size is None:
            size = DEFAULT_SIZE
            defaulted.append(name)
        code = 'B%03d' % n
        size = SIZE_OVERRIDES.get(code, SIZE_OVERRIDES.get(norm(name), size))
        items.append({'code': code, 'name': name, 'category': cat,
                      'sizeOz': size, 'form': 'bar'})

    # ---- requisition items (PDF page 1 first, Excel fills gaps)
    req = [list(x) for x in PDF_REQ]
    names = {norm(x[1]) for x in req}
    for code, name, cat in excel_req_items(wb):
        tgt = REQ_ALIAS.get(name, name)
        if norm(tgt) in names or any(norm(tgt) == k[:len(norm(tgt))] and len(norm(tgt)) > 8 for k in names):
            continue
        names.add(norm(name))
        req.append([code, name, cat])
    used = {}
    dup_notes = []
    for code, name, cat in req:
        final = code
        if final in used:
            n = 2
            while '%s-%d' % (code, n) in used:
                n += 1
            final = '%s-%d' % (code, n)
            dup_notes.append('%s -> %s (%s; first used by %s)' % (code, final, name, used[code]))
        used[final] = name
        items.append({'code': final, 'name': name, 'category': cat, 'form': 'requisition'})

    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(items, f, ensure_ascii=False, indent=2)
        f.write('\n')

    nb = sum(1 for i in items if i['form'] == 'bar')
    print('bar items: %d, requisition items: %d' % (nb, len(items) - nb))
    cats = {}
    for i in items:
        cats.setdefault((i['form'], i['category']), 0)
        cats[(i['form'], i['category'])] += 1
    for (form, cat), n in sorted(cats.items()):
        print('  %-12s %-24s %d' % (form, cat, n))
    print('\nDefaulted sizeOz=%d (no size on PDF; please correct) [%d]:' % (DEFAULT_SIZE, len(defaulted)))
    for n in defaulted:
        print('  -', n)
    print('\nExcel bar rows dropped as duplicates [%d]:' % len(dropped))
    for n in dropped:
        print('  -', n)
    print('\nDisambiguated duplicate requisition codes [%d]:' % len(dup_notes))
    for n in dup_notes:
        print('  -', n)


if __name__ == '__main__':
    main()
