#!/usr/bin/env python3
"""Writes src/data/showcase.ts from the files in public/showcase/ (run from the repository root).

Every sample comes from an openly licensed 3D model; names and image descriptions are given in
English, Arabic, Russian and French. Change the list below, then run: python3 scripts/showcase/build-data.py
"""
import json, os

P = "public/showcase"
CC_BY = ("CC BY 4.0", "https://creativecommons.org/licenses/by/4.0/")
CC0 = ("CC0 1.0 (public domain)", "https://creativecommons.org/publicdomain/zero/1.0/")
KH = "https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/"
PH = "https://polyhaven.com/a/"
ANGLE = {"a35": ["three-quarter view", "منظر جانبي مائل", "вид в три четверти", "vue de trois quarts"],
         "a0": ["front view", "منظر أمامي", "вид спереди", "vue de face"],
         "a90": ["side view", "منظر جانبي", "вид сбоку", "vue de côté"],
         "a180": ["back view", "منظر خلفي", "вид сзади", "vue de dos"],
         "top": ["view from above", "منظر من الأعلى", "вид сверху", "vue de dessus"]}
RENDER = ["render of a 3D model", "صورة من نموذج ثلاثي الأبعاد", "рендер 3D-модели", "rendu d’un modèle 3D"]
FRAME = ["frame", "لقطة", "кадр", "image"]
L = ["en", "ar", "ru", "fr"]
items = []


def alt(names, shot, li):
    return f"{names[li]} — {ANGLE[shot][li]} ({RENDER[li]})"


def item(ref, cat, folder, names, descs, shots, src_title, author, src_url, lic, featured=False, orbit=None, variants=None, sub=None):
    base = f"/showcase/{folder}"
    imgs = lambda prefix: [{"src": f"{prefix}/{s}.webp", "width": 1200, "height": 1500, "alt": alt(names, s, 0)} for s in shots]
    vlist = None
    if variants:
        vlist = [{"name": v[1], "label": v[2][0], "labels": {"ar": v[2][1], "ru": v[2][2], "fr": v[2][3]}, "images": imgs(f"{base}/{v[0]}")} for v in variants]
        images = vlist[0]["images"]
    else:
        images = imgs(base)
    view = {"kind": "model", "src": f"{base}/model.glb", "poster": images[0]["src"], "bytes": os.path.getsize(f"public{base}/model.glb")}
    if orbit:
        view["orbit"] = orbit
    if vlist:
        view["variants"] = vlist
    it = {"ref": ref, "status": "editorial_preview", "name": names[0], "category": cat, "description": descs[0], "images": images, "featured": featured, "view": view,
          "showcase": {"type": "free-model", "author": author, "source": src_title, "sourceUrl": src_url, "licence": lic[0], "licenceUrl": lic[1], "checked": "2026-10-11"},
          "translations": {l: {"name": names[i], "description": descs[i], "imageAlts": [alt(names, s, i) for s in shots]} for i, l in enumerate(L) if l != "en"}}
    if sub:
        it["subcategory"] = sub
    items.append(it)


S5 = ["a35", "a0", "a90", "a180", "top"]
NB = " "
item("DM-W-CHRONO", "watches", "ChronographWatch",
     ["Chronograph watch", "ساعة كرونوغراف", "Часы-хронограф", "Montre chronographe"],
     ["Demonstration 3D model of a chronograph watch in four colours. Choose a colour: the photos and the 360° view change together.",
      "نموذج ثلاثي الأبعاد للعرض لساعة كرونوغراف بأربعة ألوان. اختر لوناً لتتغيّر الصور وعرض 360° معاً.",
      "Демонстрационная 3D-модель часов-хронографа в четырёх цветах. Выберите цвет — фото и обзор 360° изменятся вместе.",
      f"Modèle 3D de démonstration d’une montre chronographe en quatre coloris. Choisissez un coloris{NB}: les photos et la vue 360° changent ensemble."],
     ["a0", "a35", "a90", "a180"], "Chronograph Watch, Khronos glTF Sample Assets", "Eric Chadwick (Darmstadt Graphics Group), after “Chronograph Watch Mudmaster” by graphiccompressor", KH + "ChronographWatch", CC_BY,
     featured=True, orbit="0deg 75deg auto", sub="Contemporary watches",
     variants=[("midnight-gold", "Midnight Gold", ["Gold", "ذهبي", "Золотой", "Doré"]), ("surgical-white", "Surgical White", ["White", "أبيض", "Белый", "Blanc"]),
               ("commerce-green", "Commerce Green", ["Green", "أخضر", "Зелёный", "Vert"]), ("khronos-red", "Khronos Red", ["Red", "أحمر", "Красный", "Rouge"])])
item("DM-W-POCKET", "watches", "pocket_watch", ["Pocket watch", "ساعة جيب", "Карманные часы", "Montre de poche"],
     ["Demonstration 3D model of a pocket watch with a white dial.", "نموذج ثلاثي الأبعاد للعرض لساعة جيب بميناء أبيض.", "Демонстрационная 3D-модель карманных часов с белым циферблатом.", "Modèle 3D de démonstration d’une montre de poche à cadran blanc."],
     S5, "Pocket Watch, Poly Haven", "PierreB3D", PH + "pocket_watch", CC0, sub="Vintage watches")
item("DM-W-ENGRAVED", "watches", "vintage_pocket_watch", ["Engraved pocket watch", "ساعة جيب منقوشة", "Карманные часы с гравировкой", "Montre de poche gravée"],
     ["Demonstration 3D model of an engraved pocket watch with Roman numerals.", "نموذج ثلاثي الأبعاد للعرض لساعة جيب منقوشة بأرقام رومانية.", "Демонстрационная 3D-модель карманных часов с гравировкой и римскими цифрами.", "Modèle 3D de démonstration d’une montre de poche gravée à chiffres romains."],
     S5, "Vintage Pocket Watch, Poly Haven", "Tal Swicegood", PH + "vintage_pocket_watch", CC0, sub="Vintage watches")
item("DM-W-DIGITAL", "watches", "digital_wrist_watch", ["Steel digital watch", "ساعة رقمية من الفولاذ", "Стальные электронные часы", "Montre numérique en acier"],
     ["Demonstration 3D model of a digital watch on a steel bracelet.", "نموذج ثلاثي الأبعاد للعرض لساعة رقمية بسوار فولاذي.", "Демонстрационная 3D-модель электронных часов на стальном браслете.", "Modèle 3D de démonstration d’une montre numérique sur bracelet en acier."],
     ["top", "a35", "a0", "a90"], "Digital Wrist Watch, Poly Haven", "Adrian C", PH + "digital_wrist_watch", CC0, orbit="0deg 12deg auto", sub="Contemporary watches")
item("DM-S-SNEAKER", "shoes", "MaterialsVariantsShoe", ["Knit sneaker", "حذاء رياضي محبوك", "Вязаные кроссовки", "Basket en maille"],
     ["Demonstration 3D model of a knit sneaker in three colours. Choose a colour: the photos and the 360° view change together.",
      "نموذج ثلاثي الأبعاد للعرض لحذاء رياضي محبوك بثلاثة ألوان. اختر لوناً لتتغيّر الصور وعرض 360° معاً.",
      "Демонстрационная 3D-модель вязаных кроссовок в трёх цветах. Выберите цвет — фото и обзор 360° изменятся вместе.",
      f"Modèle 3D de démonstration d’une basket en maille en trois coloris. Choisissez un coloris{NB}: les photos et la vue 360° changent ensemble."],
     ["a35", "a0", "a180", "top"], "Materials Variants Shoe, Khronos glTF Sample Assets", "Shopify", KH + "MaterialsVariantsShoe", CC_BY, featured=True, sub="Sneakers",
     variants=[("midnight", "midnight", ["Blue", "أزرق", "Синий", "Bleu"]), ("beach", "beach", ["Pink", "وردي", "Розовый", "Rose"]), ("street", "street", ["Black", "أسود", "Чёрный", "Noir"])])
item("DM-S-BOOTS", "shoes", "boots_clean", ["Rubber boots", "حذاء مطاطي طويل", "Резиновые сапоги", "Bottes en caoutchouc"],
     ["Demonstration 3D model of a pair of glossy rubber boots.", "نموذج ثلاثي الأبعاد للعرض لزوج من الأحذية المطاطية اللامعة.", "Демонстрационная 3D-модель пары глянцевых резиновых сапог.", "Modèle 3D de démonstration d’une paire de bottes en caoutchouc brillant."],
     S5, "Rubber Boots, Poly Haven", "L (Poly Haven)", PH + "rubber_boots", CC0, sub="Boots")
item("DM-A-SUNGLASSES", "accessories", "SunglassesKhronos", ["Aviator sunglasses", "نظارة شمسية أفياتور", "Солнцезащитные очки-авиаторы", "Lunettes de soleil aviateur"],
     ["Demonstration 3D model of aviator sunglasses with mirrored lenses.", "نموذج ثلاثي الأبعاد للعرض لنظارة شمسية أفياتور بعدسات عاكسة.", "Демонстрационная 3D-модель очков-авиаторов с зеркальными линзами.", "Modèle 3D de démonstration de lunettes aviateur à verres miroir."],
     S5, "Sunglasses Khronos, Khronos glTF Sample Assets", "Eric Chadwick (Darmstadt Graphics Group)", KH + "SunglassesKhronos", CC_BY, featured=True)
item("DM-A-SPECTACLES", "accessories", "round_spectacles", ["Round spectacles", "نظارة دائرية", "Круглые очки", "Lunettes rondes"],
     ["Demonstration 3D model of round spectacles with dark lenses.", "نموذج ثلاثي الأبعاد للعرض لنظارة دائرية بعدسات داكنة.", "Демонстрационная 3D-модель круглых очков с тёмными линзами.", "Modèle 3D de démonstration de lunettes rondes à verres foncés."],
     S5, "Round Spectacles, Poly Haven", "Sean Buckley", PH + "round_spectacles", CC0)
item("DM-A-HAT", "accessories", "fishermans_hat", ["Bucket hat", "قبعة بحافة", "Панама", "Bob"],
     ["Demonstration 3D model of a cotton bucket hat.", "نموذج ثلاثي الأبعاد للعرض لقبعة قطنية بحافة.", "Демонстрационная 3D-модель хлопковой панамы.", "Modèle 3D de démonstration d’un bob en coton."],
     S5, "Fishermans Hat, Poly Haven", "PierreB3D", PH + "fishermans_hat", CC0)
item("DM-B-SUITCASE", "bags", "suitcase_plain", ["Vintage suitcase", "حقيبة سفر كلاسيكية", "Винтажный чемодан", "Valise vintage"],
     ["Demonstration 3D model of a green leather-look vintage suitcase.", "نموذج ثلاثي الأبعاد للعرض لحقيبة سفر كلاسيكية خضراء.", "Демонстрационная 3D-модель зелёного винтажного чемодана.", "Modèle 3D de démonstration d’une valise vintage verte."],
     S5, "Vintage Suitcase, Poly Haven", "Maximilian Schuster", PH + "vintage_suitcase", CC0, featured=True, sub="Travel")
item("DM-B-SUITCASE-LABELS", "bags", "suitcase_labels", ["Vintage suitcase with travel labels", "حقيبة سفر كلاسيكية بملصقات سفر", "Винтажный чемодан с дорожными наклейками", "Valise vintage à étiquettes de voyage"],
     ["Demonstration 3D model of a vintage suitcase covered in travel labels.", "نموذج ثلاثي الأبعاد للعرض لحقيبة سفر كلاسيكية مغطاة بملصقات السفر.", "Демонстрационная 3D-модель винтажного чемодана с дорожными наклейками.", "Modèle 3D de démonstration d’une valise vintage couverte d’étiquettes de voyage."],
     S5, "Vintage Suitcase, Poly Haven", "Maximilian Schuster", PH + "vintage_suitcase", CC0, sub="Travel")

# Photo-spin sample: 36 frames rendered from the pink sneaker (the path real turntable photos take).
frames = [{"src": f"/showcase/sneaker-spin/f{i:02d}.webp", "zoom": f"/showcase/sneaker-spin/f{i:02d}-zoom.webp", "width": 800, "height": 1000} for i in range(36)]
sn = ["Knit sneaker, pink — photo spin", "حذاء رياضي محبوك، وردي — دوران بالصور", "Вязаные кроссовки, розовые — вращение по кадрам", "Basket en maille, rose — rotation en images"]
sd = ["The same demonstration sneaker as a photo spin: 36 frames, one every 10°, in one horizontal turn. Your own turntable photographs will work the same way.",
      "الحذاء نفسه معروضاً كدوران بالصور: 36 لقطة، واحدة كل 10°، في دورة أفقية واحدة. ستعمل صور منتجاتك الملتقطة على قاعدة دوّارة بالطريقة نفسها.",
      "Те же демонстрационные кроссовки в виде вращения по кадрам: 36 кадров, по одному каждые 10°, в одном горизонтальном обороте. Ваши фото с поворотного столика будут работать так же.",
      f"La même basket de démonstration en rotation d’images{NB}: 36 images, une tous les 10°, sur un tour horizontal. Vos propres photos sur plateau tournant fonctionneront de la même façon."]
gal = [0, 9, 18, 27]
items.insert(5, {"ref": "DM-S-SNEAKER-SPIN", "status": "editorial_preview", "name": sn[0], "category": "shoes", "subcategory": "Sneakers", "description": sd[0],
                 "images": [{"src": frames[i]["src"], "width": 800, "height": 1000, "alt": f"{sn[0]} — {FRAME[0]} {i + 1} of 36 ({RENDER[0]})"} for i in gal],
                 "featured": True, "view": {"kind": "spin", "frames": frames, "start": 0},
                 "showcase": {"type": "photo-spin", "author": "Shopify", "source": "Materials Variants Shoe, Khronos glTF Sample Assets", "sourceUrl": KH + "MaterialsVariantsShoe", "licence": CC_BY[0], "licenceUrl": CC_BY[1], "checked": "2026-10-11"},
                 "translations": {l: {"name": sn[k], "description": sd[k], "imageAlts": [f"{sn[k]} — {FRAME[k]} {i + 1}/36 ({RENDER[k]})" for i in gal]} for k, l in enumerate(L) if l != "en"}})

HEADER = '''import type { Item } from "./types";

/**
 * DEMONSTRATION SAMPLES for the 360° view — protected preview only (see showcaseEnabled in
 * src/config/site.ts); never loaded on production. They are not for sale: no price, stock,
 * authentication or delivery, and they can't be added to the bag (editorial_preview rules).
 *
 * Every file comes from an openly licensed 3D model (Khronos glTF Sample Assets, CC BY 4.0, or
 * Poly Haven, CC0). Gallery images and the photo-spin frames are renders of those models, made by
 * scripts/showcase/ in this branch. Sources and licences: ASSETS.md and each item's `showcase`.
 * Generated by scripts/showcase/build-data.py — edit that script, not this file.
 */
export const showcaseItems: Item[] = '''
with open("src/data/showcase.ts", "w", encoding="utf-8") as f:
    f.write(HEADER + json.dumps(items, ensure_ascii=False, indent=2) + ";\n")
print(len(items), "items")
