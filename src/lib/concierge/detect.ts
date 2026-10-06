/**
 * Lightweight, deterministic understanding of what a customer typed (English and Arabic).
 * It only fills in details the customer actually wrote; anything it misses is simply asked.
 * The optional AI provider can improve on it, but the chat never depends on AI.
 */

/** The four active categories, plus "other" so a request outside them is still taken down for the team. */
export type CategoryKey = "bags" | "watches" | "shoes" | "accessories" | "other";
export type Intent = "sourcing" | "question" | "order" | "callback";
export type Topic = "price" | "authenticity" | "shipping" | "returns" | "other";

export interface Extracted {
  category?: CategoryKey;
  brand?: string;
  model?: string;
  colour?: string;
  size?: string;
  year?: string;
}

/** Brand names as written by customers → display name. Arabic spellings included for the main houses. */
const BRANDS: [RegExp, string][] = [
  [/\bherm[eè]s\b|هيرم(ي)?س|هرمز/i, "Hermès"],
  [/\bchanel\b|شانيل/i, "Chanel"],
  [/\blouis\s*vuitton\b|\blv\b|لويس\s*فيتون/i, "Louis Vuitton"],
  [/\bdior\b|ديور/i, "Dior"],
  [/\bgucci\b|غوتشي|قوتشي|جوتشي/i, "Gucci"],
  [/\bprada\b|برادا/i, "Prada"],
  [/\bbottega(\s*veneta)?\b|بوتيغا/i, "Bottega Veneta"],
  [/\bfendi\b|فندي/i, "Fendi"],
  [/\bc[eé]line\b|سيلين/i, "Celine"],
  [/\bgoyard\b|غويارد/i, "Goyard"],
  [/\bsaint\s*laurent\b|\bysl\b|سان\s*لوران/i, "Saint Laurent"],
  [/\bloewe\b|لويفي/i, "Loewe"],
  [/\bvalentino\b|فالنتينو/i, "Valentino"],
  [/\bbalenciaga\b|بالنسياغا/i, "Balenciaga"],
  [/\bgivenchy\b|جيفنشي/i, "Givenchy"],
  [/\bmiu\s*miu\b|ميو\s*ميو/i, "Miu Miu"],
  [/\bthe\s*row\b/i, "The Row"],
  [/\bmoynat\b/i, "Moynat"],
  [/\bdelvaux\b/i, "Delvaux"],
  [/\brolex\b|رولكس/i, "Rolex"],
  [/\bpatek(\s*philippe)?\b|باتيك/i, "Patek Philippe"],
  [/\baudemars(\s*piguet)?\b|\bap\b(?=\s*(royal|watch|ساعة))|أوديمار|اوديمار/i, "Audemars Piguet"],
  [/\brichard\s*mille\b|ريتشارد\s*ميل/i, "Richard Mille"],
  [/\bcartier\b|كارتييه|كارتير/i, "Cartier"],
  [/\bvacheron(\s*constantin)?\b|فاشرون/i, "Vacheron Constantin"],
  [/\bomega\b|أوميغا|اوميغا/i, "Omega"],
  [/\bb(v|u)lgari\b|بولغاري|بولغري|بلغاري/i, "Bvlgari"],
  [/\bvan\s*cleef(\s*(&|and)\s*arpels)?\b|\bvca\b|فان\s*كليف/i, "Van Cleef & Arpels"],
  [/\btiffany\b|تيفاني/i, "Tiffany & Co."],
  [/\bchopard\b|شوبارد/i, "Chopard"],
  [/\bgraff\b|غراف/i, "Graff"],
  [/\bharry\s*winston\b/i, "Harry Winston"],
  [/\bjaeger[-\s]*le\s*coultre\b|\bjlc\b/i, "Jaeger-LeCoultre"],
  [/\biwc\b/i, "IWC"],
  [/\bhublot\b|هوبلو/i, "Hublot"],
  [/\bpanerai\b|بانيراي/i, "Panerai"],
  [/\bbreguet\b|بريغيه/i, "Breguet"],
  [/\b(a\.?\s*)?lange(\s*(&|und)\s*s[oö]hne)?\b/i, "A. Lange & Söhne"],
  [/\bf\.?\s*p\.?\s*journe\b/i, "F.P. Journe"],
  [/\btudor\b|تيودور/i, "Tudor"],
  [/\b(christian\s*)?louboutin\b|لوبوتان/i, "Christian Louboutin"],
  [/\bmanolo(\s*blahnik)?\b|مانولو/i, "Manolo Blahnik"],
  [/\bjimmy\s*choo\b|جيمي\s*تشو/i, "Jimmy Choo"],
  [/\baquazzura\b/i, "Aquazzura"],
  [/\bgianvito(\s*rossi)?\b/i, "Gianvito Rossi"],
  [/\broger\s*vivier\b/i, "Roger Vivier"],
];

/** Model names that also tell us the brand and category. */
const MODELS: [RegExp, string, string, CategoryKey][] = [
  [/\bbirkin\b|بيركين/i, "Birkin", "Hermès", "bags"],
  [/\bkelly\b|كيلي/i, "Kelly", "Hermès", "bags"],
  [/\bconstance\b|كونستانس/i, "Constance", "Hermès", "bags"],
  [/\bpicotin\b/i, "Picotin", "Hermès", "bags"],
  [/\bevelyne\b/i, "Evelyne", "Hermès", "bags"],
  [/\b(classic\s*)?flap\b|\b2\.55\b/i, "Classic Flap", "Chanel", "bags"],
  [/\bboy\s*bag\b/i, "Boy", "Chanel", "bags"],
  [/\blady\s*dior\b|ليدي\s*ديور/i, "Lady Dior", "Dior", "bags"],
  [/\bspeedy\b/i, "Speedy", "Louis Vuitton", "bags"],
  [/\bneverfull\b/i, "Neverfull", "Louis Vuitton", "bags"],
  [/\bdaytona\b|دايتونا/i, "Daytona", "Rolex", "watches"],
  [/\bsubmariner\b|صب\s*مارينر/i, "Submariner", "Rolex", "watches"],
  [/\bgmt[-\s]*master\b/i, "GMT-Master", "Rolex", "watches"],
  [/\bdatejust\b|ديت\s*جست/i, "Datejust", "Rolex", "watches"],
  [/\bday[-\s]*date\b/i, "Day-Date", "Rolex", "watches"],
  [/\bnautilus\b|نوتيلوس/i, "Nautilus", "Patek Philippe", "watches"],
  [/\baquanaut\b/i, "Aquanaut", "Patek Philippe", "watches"],
  [/\broyal\s*oak\b|رويال\s*أوك/i, "Royal Oak", "Audemars Piguet", "watches"],
  [/\balhambra\b|الهمبرا/i, "Alhambra", "Van Cleef & Arpels", "other"],
  [/\blove\s*bracelet\b/i, "Love bracelet", "Cartier", "other"],
  [/\bjuste\s*un\s*clou\b/i, "Juste un Clou", "Cartier", "other"],
  [/\bserpenti\b/i, "Serpenti", "Bvlgari", "other"],
];

const CATEGORY_WORDS: [RegExp, CategoryKey][] = [
  [/\b(hand)?bags?\b|\bclutch(es)?\b|\btote\b|\bpurse\b|\bwallet\b|حقيب|شنط|محفظ/i, "bags"],
  [/\bwatch(es)?\b|\btimepiece\b|ساع/i, "watches"],
  [/\bshoes?\b|\bheels?\b|\bsneakers?\b|\bsandals?\b|\bloafers?\b|\bboots?\b|\bpumps?\b|\bmules?\b|حذاء|أحذية|احذية|جزم|صندل|كعب/i, "shoes"],
  [/\brings?\b|\bnecklace\b|\bbracelet\b|\bearrings?\b|\bpendant\b|\bjewel(le)?ry\b|خاتم|قلادة|عقد|سوار|أسورة|اسوارة|أقراط|حلق|مجوهرات/i, "other"],
  [/\bbelt\b|\bscarf\b|\bsunglasses\b|\bcharm\b|حزام|وشاح|نظار/i, "accessories"],
];

const BRAND_CATEGORY: Record<string, CategoryKey> = {
  Rolex: "watches", "Patek Philippe": "watches", "Audemars Piguet": "watches", "Richard Mille": "watches",
  "Vacheron Constantin": "watches", Omega: "watches", "Jaeger-LeCoultre": "watches", IWC: "watches", Hublot: "watches",
  Panerai: "watches", Breguet: "watches", "A. Lange & Söhne": "watches", "F.P. Journe": "watches", Tudor: "watches",
  "Christian Louboutin": "shoes", "Manolo Blahnik": "shoes", "Jimmy Choo": "shoes", Aquazzura: "shoes", "Gianvito Rossi": "shoes",
  "Van Cleef & Arpels": "other", Graff: "other", "Harry Winston": "other", Goyard: "bags", Moynat: "bags", Delvaux: "bags",
};

const COLOURS: [RegExp, string][] = [
  [/\bblack\b|\bnoir\b|أسود|اسود|سوداء/i, "black"],
  [/\bwhite\b|\bblanc\b|أبيض|ابيض|بيضاء/i, "white"],
  [/\bgold\b|ذهبي|ذهب/i, "gold"],
  [/\b[eé]toupe\b/i, "etoupe"],
  [/\bbeige\b|\bcraie\b|بيج/i, "beige"],
  [/\bbrown\b|\bchocolate\b|بني/i, "brown"],
  [/\bred\b|\brouge\b|أحمر|احمر|حمراء/i, "red"],
  [/\bpink\b|\brose\b|وردي|زهري/i, "pink"],
  [/\bblue\b|\bbleu\b|\bnavy\b|أزرق|ازرق|كحلي/i, "blue"],
  [/\bgreen\b|\bvert\b|أخضر|اخضر/i, "green"],
  [/\bgr[ae]y\b|رمادي/i, "grey"],
  [/\borange\b|برتقالي/i, "orange"],
  [/\byellow\b|أصفر|اصفر/i, "yellow"],
  [/\bpurple\b|\bviolet\b|بنفسجي/i, "purple"],
  [/\bsilver\b|فضي/i, "silver"],
  [/\brose\s*gold\b/i, "rose gold"],
];

const SIZE_PATTERNS = [
  /\b(?:size|sz|eu|uk|us)\s*\d{1,2}(?:[.,]5)?\b/i,
  /\bمقاس\s*\d{1,2}(?:[.,]5)?/,
  /\b\d{2}\s?mm\b/i,
  /\b(?:birkin|kelly|constance|picotin)\s*(\d{2})\b/i,
  /\b(?:mini|small|medium|large|pm|mm|gm)\b/i,
];

const REF_PATTERN = /\b\d{4,6}(?:\/\d[A-Z])?[A-Z]{0,4}\b/;
const YEAR_PATTERN = /\b(19[5-9]\d|20[0-2]\d)\b/;

export function extract(text: string): Extracted {
  const out: Extracted = {};
  for (const [re, model, brand, category] of MODELS) {
    if (re.test(text)) {
      out.model = model;
      out.brand = brand;
      out.category = category;
      break;
    }
  }
  if (!out.brand) for (const [re, name] of BRANDS) if (re.test(text)) { out.brand = name; break; }
  if (!out.category) for (const [re, cat] of CATEGORY_WORDS) if (re.test(text)) { out.category = cat; break; }
  if (!out.category && out.brand && BRAND_CATEGORY[out.brand]) out.category = BRAND_CATEGORY[out.brand];
  const colour = COLOURS.find(([re]) => re.test(text));
  if (colour) out.colour = colour[1];
  for (const re of SIZE_PATTERNS) {
    const m = text.match(re);
    if (m) {
      out.size = (m[1] ?? m[0]).trim();
      break;
    }
  }
  const year = text.match(YEAR_PATTERN);
  if (year) out.year = year[1];
  if (!out.model && out.category === "watches") {
    const ref = text.replace(YEAR_PATTERN, "").match(REF_PATTERN);
    if (ref) out.model = ref[0];
  }
  return out;
}

/** True when the description already carries enough detail to skip the follow-up question. */
export function hasEnoughDetail(d: Extracted & { description?: string }) {
  const known = [d.model, d.colour, d.size, d.year].filter(Boolean).length;
  return known >= 2 || (d.description?.trim().length ?? 0) > 90;
}

const INTENTS: [RegExp, Intent, Topic?][] = [
  [/\bORD-?[A-Z0-9]{6}\b|\b(track|tracking|my order|order status|delivery status)\b|تتبع|طلبي|حالة الطلب|رقم الطلب/i, "order"],
  [/\b(call me|call back|callback|speak to|talk to|human|person|agent|representative)\b|اتصل|اتصال|تكلم|موظف|شخص/i, "callback"],
  [/\b(authentic|genuine|real|fake|replica|certificate)\b|أصلي|اصلي|مقلد|تقليد|شهادة/i, "question", "authenticity"],
  [/\b(ship|shipping|deliver|delivery|courier|customs)\b|شحن|توصيل|جمارك/i, "question", "shipping"],
  [/\b(return|returns|refund|exchange)\b|إرجاع|ارجاع|استرجاع|استرداد|استبدال/i, "question", "returns"],
  [/\b(price|cost|how much|available|availability|in stock)\b|سعر|بكم|كم سعر|متوفر|متوفرة|توفر/i, "question", "price"],
];

export function detectIntent(text: string): { intent?: Intent; topic?: Topic } {
  for (const [re, intent, topic] of INTENTS) if (re.test(text)) return { intent, topic };
  return {};
}

/** Product reference typed directly or inside a website link (…/collection?item=SH-0001). */
export function findItemRef(text: string) {
  const fromUrl = text.match(/[?&]item=([A-Za-z0-9-]{2,40})/);
  if (fromUrl) return fromUrl[1];
  const direct = text.match(/\b([A-Za-z]{1,6}-[A-Za-z0-9]{1,12}(?:-[A-Za-z0-9]{1,12})?)\b/);
  return direct && !/^ORD-|^REQ-/i.test(direct[1]) ? direct[1] : undefined;
}

export function normaliseOrderRef(text: string) {
  const m = text.toUpperCase().replace(/\s+/g, "").match(/ORD-?([A-Z0-9]{6})\b/);
  return m ? `ORD-${m[1]}` : undefined;
}

/** Simple choice matching for typed answers: exact label, number ("2") or a leading word. */
export function matchChoice(text: string, choices: { id: string; label: string }[]) {
  const s = text.trim().toLowerCase();
  if (!s) return undefined;
  const n = Number(s);
  if (Number.isInteger(n) && n >= 1 && n <= choices.length) return choices[n - 1];
  return (
    choices.find((c) => c.label.toLowerCase() === s || c.id === s) ??
    choices.find((c) => s.length >= 3 && c.label.toLowerCase().startsWith(s))
  );
}

// \b does not work around Arabic letters in JavaScript, so the end of a word is matched explicitly.
export const YES = /^(y|yes|yeah|yep|sure|ok|okay|please|correct|right|نعم|أجل|اجل|صحيح|تمام|اكيد|أكيد|طيب)(?=$|[\s,.!؟?،])/i;
export const NO = /^(n|no|nope|not really|no thanks|لا|كلا|ليس)(?=$|[\s,.!؟?،])/i;
