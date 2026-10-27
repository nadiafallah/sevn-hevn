-- Starting rows for the compliance ledger (migration 20261027191858_compliance.sql).
-- ALREADY APPLIED IN PRODUCTION on 27 Oct 2026. Run this only on a fresh database.
-- After this, rules change only through approved compliance changes (docs/COMPLIANCE.md).
-- Research of 27 Oct 2026; the weekly monitor checks each rule against the official text.

insert into public.compliance_sources (code, name, authority, url, watch_for) values
('leg-fdl-14-2023', 'Federal Decree-Law 14/2023 on e-commerce', 'UAE Legislation portal', 'https://uaelegislation.gov.ae/en/legislations/2150', 'Amendments; executive regulation; any article on returns, insurance, digital invoices, seller disclosures'),
('leg-cr-66-2023', 'Cabinet Resolution 66/2023 (consumer protection executive regulation)', 'UAE Legislation portal', 'https://uaelegislation.gov.ae/en/legislations/2157', 'Amendments to return, warranty, defect windows, discount rule, prohibited clauses, e-commerce article 40, language rules'),
('leg-cr-200-2025', 'Cabinet Resolution 200/2025 (e-commerce penalties)', 'UAE Legislation portal', 'https://uaelegislation.gov.ae/en/legislations/3989', 'New or changed violations and penalty amounts'),
('leg-new', 'New federal legislation', 'UAE Legislation portal', 'https://uaelegislation.gov.ae/en/legislations', 'New laws or cabinet resolutions on consumer protection, e-commerce, VAT, personal data, AML, child digital safety'),
('uae-ecommerce', 'u.ae eCommerce guidance', 'UAE Government portal', 'https://u.ae/en/information-and-services/business/ecommerce', 'Licensing route, TDRA approval, seller obligations, free-zone selling to mainland'),
('moet', 'Ministry of Economy and Tourism', 'MoET', 'https://www.moet.gov.ae/en', 'Consumer protection decisions and circulars; DPMS AML guidance and circulars'),
('fta', 'Federal Tax Authority', 'FTA', 'https://tax.gov.ae/en', 'VAT rate, registration thresholds, public clarifications, profit margin scheme guide, price display, tax invoice rules'),
('mof-einvoicing', 'Ministry of Finance e-invoicing', 'MoF', 'https://mof.gov.ae', 'E-invoicing decisions, phase dates, ASP appointment deadlines, B2C scope'),
('det', 'Dubai Department of Economy and Tourism', 'DET', 'https://www.det.gov.ae', 'E-commerce licences, e-trader permits, free-zone companies selling into Dubai mainland'),
('tdra', 'Telecommunications and Digital Government Regulatory Authority', 'TDRA', 'https://tdra.gov.ae', 'E-commerce approvals, digital activity NOC'),
('uaefiu', 'UAE Financial Intelligence Unit (goAML)', 'UAEFIU / CBUAE', 'https://www.uaefiu.gov.ae', 'DPMSR threshold or reporting changes, goAML registration rules'),
('pdpl', 'Personal Data Protection Law status', 'UAE Data Office', 'https://u.ae/en/about-the-uae/digital-uae/data/data-protection-laws', 'Issue of PDPL executive regulations, enforcement start, cookie or consent guidance');

insert into public.compliance_rules (code, area, title_en, title_fa, requirement_en, requirement_fa, applies_to, site_action, site_params, law_reference, source_url, certainty, effective_from, last_verified_at, notes) values
('LIC-ECOM-LICENCE', 'licensing', 'Trade licence with e-commerce activity', 'لایسنس تجاری با فعالیت تجارت الکترونیک',
 'To sell online on the UAE mainland the business needs a commercial licence that includes e-commerce activity from the emirate economic department (Dubai: DET), or a free-zone licence that permits e-commerce. All e-commerce licences also require TDRA approval.',
 'برای فروش آنلاین در سرزمین اصلی امارات، لایسنس تجاری با فعالیت تجارت الکترونیک از اداره اقتصاد امارت (در دبی DET) یا لایسنس فری‌زونی که تجارت الکترونیک را مجاز کند لازم است. همه لایسنس‌های تجارت الکترونیک به تأیید TDRA هم نیاز دارند.',
 '{all}', 'Show licence number and issuing authority in the footer and on the checkout page. Do not take paid orders until the licence number is set.',
 '{"show_in_footer": true, "show_at_checkout": true}', 'Federal Decree-Law 14/2023, Art. 5; u.ae eCommerce guidance', 'https://u.ae/en/information-and-services/business/ecommerce', 'confirmed', null, now(), null),

('LIC-FREEZONE-MAINLAND', 'licensing', 'Free-zone company selling to mainland customers', 'فروش شرکت فری‌زونی به مشتری سرزمین اصلی',
 'Free-zone companies may operate inside the free zone and internationally; selling directly to buyers on the UAE mainland may need an additional permit or a commercial agent.',
 'شرکت‌های فری‌زونی داخل فری‌زون و به‌صورت بین‌المللی می‌توانند فعالیت کنند؛ فروش مستقیم به مشتری داخل سرزمین اصلی ممکن است مجوز اضافه یا نماینده تجاری لازم داشته باشد.',
 '{free_zone}', 'If the licence is a free-zone licence, confirm the mainland selling permit before accepting UAE mainland delivery addresses.',
 '{}', 'u.ae eCommerce guidance (free zones)', 'https://u.ae/en/information-and-services/business/ecommerce', 'needs_lawyer', null, now(), 'The free zone that issued the licence decides the answer. Confirm with DET or the free zone authority.'),

('DIS-PRE-ORDER', 'disclosure', 'Information shown before the order is confirmed', 'اطلاعاتی که باید قبل از تأیید سفارش نمایش داده شود',
 'Before the customer confirms, the seller must show its trade licence number, full business details and contact, the total price including delivery, the standard specifications of the item, and the return, exchange and warranty terms.',
 'قبل از اینکه مشتری سفارش را تأیید کند، فروشنده باید شماره لایسنس، مشخصات کامل کسب‌وکار و راه تماس، قیمت نهایی همراه هزینه ارسال، مشخصات کالا، و شرایط مرجوعی، تعویض و گارانتی را نمایش دهد.',
 '{all}', 'Checkout summary shows licence no., business name, address, phone, email, item total, delivery fee, VAT and grand total, with links to returns and warranty terms; a required tick box confirms the buyer has read the returns and warranty terms before payment.',
 '{"require_terms_checkbox": true}', 'Cabinet Resolution 66/2023, Art. 40; Federal Decree-Law 14/2023', 'https://uaelegislation.gov.ae/en/legislations/2157', 'confirmed', null, null, 'Exact list taken from law-firm summaries; check against the Art. 40 text.'),

('DIS-CONDITION', 'disclosure', 'Full condition disclosure for pre-owned items', 'اعلام کامل وضعیت کالای دست‌دوم',
 'The seller must fully inform the consumer of the state of what they are buying (used, damaged, refurbished) and must not create a misleading impression.',
 'فروشنده باید وضعیت کالا را (کارکرده، آسیب‌دیده، بازسازی‌شده) کامل به مشتری اعلام کند و نباید تصور گمراه‌کننده ایجاد کند.',
 '{pre_owned}', 'Every pre-owned product needs a condition grade and condition notes before it can be published; show close-up photos of any wear.',
 '{"required_product_fields": ["condition", "condition_notes"]}', 'Cabinet Resolution 66/2023, Art. 7', 'https://uaelegislation.gov.ae/en/legislations/2157', 'confirmed', null, null, null),

('DIS-ARABIC', 'disclosure', 'Arabic on invoices and key terms', 'زبان عربی در فاکتور و شرایط اصلی',
 'Consumer protection rules include language requirements for invoices and product information. The exact scope (Arabic required, other languages allowed alongside) must be confirmed against the regulation text.',
 'قوانین حمایت از مصرف‌کننده برای فاکتور و اطلاعات کالا الزام زبانی دارند. دامنهٔ دقیق (عربی الزامی، زبان دیگر در کنارش مجاز) باید با متن آیین‌نامه تأیید شود.',
 '{all}', 'Pending verification: plan for Arabic alongside English on invoices and on the returns and terms pages.',
 '{}', 'Federal Law 15/2020 and Cabinet Resolution 66/2023 (language provisions)', 'https://cms.law/en/are/legal-updates/the-uae-s-new-consumer-protection-landscape-implications-and-key-provisions', 'unverified', null, null, 'Only one secondary source mentions language requirements. Monitor to find the article.'),

('RET-DEFECT-REMEDY', 'returns', 'Defective goods: repair, replace or refund at seller cost', 'کالای معیوب: تعمیر، تعویض یا بازپرداخت با هزینهٔ فروشنده',
 'If a product is defective, the supplier must take it back and repair or replace it at its own expense, or refund the full price.',
 'اگر کالا معیوب باشد، فروشنده باید آن را پس بگیرد و با هزینهٔ خودش تعمیر یا تعویض کند، یا کل مبلغ را برگرداند.',
 '{all}', 'Returns portal always offers a defective route regardless of other windows; return shipping for defects is paid by the store.',
 '{"free_return_shipping_for_defects": true, "remedies": ["repair", "replace", "refund"]}', 'Federal Law 15/2020, Art. 12; Cabinet Resolution 66/2023, Art. 20 and 27', 'https://uaelegislation.gov.ae/en/legislations/2157', 'confirmed', null, null, null),

('RET-NO-WARRANTY-30', 'returns', 'Items without warranty: defect found within 30 days', 'کالای بدون گارانتی: عیب کشف‌شده ظرف ۳۰ روز',
 'For goods without a product warranty, if a defect is discovered within 30 days of purchase the consumer can recover the price. This is a defect window, not a change-of-mind window.',
 'برای کالای بدون گارانتی، اگر عیب ظرف ۳۰ روز از خرید کشف شود، مشتری می‌تواند مبلغ را پس بگیرد. این مهلت برای عیب است، نه پشیمانی.',
 '{all}', 'Returns portal accepts defect claims up to defect_window_days from the purchase date for items sold without a warranty.',
 '{"defect_window_days": 30, "window_starts": "purchase_date"}', 'Cabinet Resolution 66/2023, Art. 25', 'https://uaelegislation.gov.ae/en/legislations/2157', 'confirmed', null, null, null),

('RET-ONLINE-NONCONFORM', 'returns', 'Online orders: defective, damaged, late or not as described', 'سفارش آنلاین: معیوب، آسیب‌دیده، دیررس یا مغایر با توضیحات',
 'A consumer who bought online may return goods that arrive defective, damaged, late, not as described, or in breach of the seller terms.',
 'مشتری خرید آنلاین می‌تواند کالایی را که معیوب، آسیب‌دیده، دیرتر از موعد، مغایر با توضیحات یا برخلاف شرایط فروشنده رسیده، مرجوع کند.',
 '{all}', 'Returns portal offers each ground as a reason; late is checked against the promised delivery date stored on the order.',
 '{"grounds": ["defective", "damaged", "late", "not_as_described", "breach_of_terms"]}', 'Federal Decree-Law 14/2023, Art. 7', 'https://uaelegislation.gov.ae/en/legislations/2150', 'unverified', null, null, 'Single secondary source (casedaleel.com). Check Art. 7 text.'),

('RET-NO-BLANKET-EXCLUSION', 'returns', 'No blanket no-returns terms', 'ممنوعیت شرط کلی «پس گرفته نمی‌شود»',
 'Terms that waive consumer rights are void. A blanket notice that goods sold are not returnable is void except for defects the buyer accepted at sale, goods that cannot be returned by nature, perishables, custom-made items, and books, newspapers and magazines.',
 'هر شرطی که حقوق مصرف‌کننده را سلب کند باطل است. اعلام کلی «کالای فروخته‌شده پس گرفته نمی‌شود» باطل است، مگر برای عیبی که خریدار هنگام خرید پذیرفته، کالایی که ذاتاً قابل برگشت نیست، کالای فاسدشدنی، کالای سفارشی، و کتاب و مجله.',
 '{all}', 'Never show final sale or no returns on a product unless it falls in a listed exclusion; known defects accepted at sale are listed on the product and in the order confirmation.',
 '{"allowed_exclusions": ["known_defect_accepted_at_sale", "non_returnable_by_nature", "perishable", "custom_made", "books_newspapers_magazines"]}', 'Cabinet Resolution 66/2023, Art. 34', 'https://uaelegislation.gov.ae/en/legislations/2157', 'confirmed', null, null, null),

('RET-CHANGE-OF-MIND', 'returns', 'Change-of-mind returns for online purchases', 'مرجوعی آنلاین به دلیل پشیمانی',
 'Sources disagree. Some say online buyers may cancel and return non-defective goods within 7 days of delivery; others say this is set only by the published seller policy. Store default: 7 days from delivery, item unused with tags and packaging.',
 'منابع اختلاف دارند. بعضی می‌گویند خریدار آنلاین می‌تواند کالای سالم را تا ۷ روز بعد از تحویل لغو و مرجوع کند؛ بعضی دیگر می‌گویند این فقط طبق سیاست منتشرشدهٔ فروشنده است. پیش‌فرض فروشگاه: ۷ روز از تحویل، کالا استفاده‌نشده با برچسب و بسته‌بندی.',
 '{all}', 'Returns portal allows change-of-mind requests within change_of_mind_days of delivery; the window is stated on the product page and at checkout.',
 '{"change_of_mind_days": 7, "window_starts": "delivery_date", "condition": "unused_with_tags_and_packaging"}', 'Cabinet Resolution 66/2023 (distance selling) - disputed', 'https://uaefreezonefinder.com/uae-consumer-protection-complaint-guide-2026/', 'disputed', null, null, 'Opposing view: uaeexperthub.com says the online right is contractual only. Lawyer to confirm.'),

('RET-POLICY-PUBLISHED', 'returns', 'Return and refund mechanism published on the website', 'انتشار سازوکار مرجوعی و بازپرداخت روی سایت',
 'The supplier must have a mechanism for returns, exchanges and refunds that is readily accessible to customers and published on its website.',
 'فروشنده باید سازوکار مرجوعی، تعویض و بازپرداخت داشته باشد که به‌راحتی در دسترس مشتری باشد و روی سایتش منتشر شده باشد.',
 '{all}', 'Returns policy page linked from the footer, every product page and checkout; the policy text reads its windows from these rules.',
 '{}', 'Cabinet Resolution 66/2023', 'https://insightplus.bakermckenzie.com/bm/consumer-goods-retail_1/uae-enhancing-consumer-rights-exploring-the-uaes-latest-consumer-protection-regulations', 'confirmed', null, null, null),

('PRC-DISCOUNT-7D', 'pricing', 'Discounts within one week after purchase', 'تخفیف تا یک هفته بعد از خرید',
 'The supplier must inform the customer of any discount it will offer on the product within one week of the purchase date. If it fails to, the customer is refunded the price difference within 30 days of purchase.',
 'فروشنده باید هر تخفیفی را که تا یک هفته بعد از خرید روی همان کالا ارائه می‌دهد به مشتری اطلاع دهد. اگر نکند، مابه‌التفاوت ظرف ۳۰ روز از خرید به مشتری برگردانده می‌شود.',
 '{all}', 'When a product price drops within discount_lookback_days of a sale of that product, alert the owner and refund the difference to that buyer.',
 '{"discount_lookback_days": 7, "refund_within_days": 30}', 'Cabinet Resolution 66/2023', 'https://insightplus.bakermckenzie.com/bm/consumer-goods-retail_1/uae-enhancing-consumer-rights-exploring-the-uaes-latest-consumer-protection-regulations', 'confirmed', '2023-10-14', null, null),

('VAT-REGISTRATION', 'vat', 'VAT registration thresholds and rate', 'آستانهٔ ثبت‌نام VAT و نرخ آن',
 'A UAE business must register for VAT if taxable supplies and imports exceeded AED 375,000 over the past 12 months or are expected to within the next 30 days. Voluntary registration from AED 187,500. Standard rate 5%.',
 'کسب‌وکار امارات اگر فروش و واردات مشمول مالیاتش در ۱۲ ماه گذشته از ۳۷۵ هزار درهم بیشتر شده یا ظرف ۳۰ روز آینده بیشتر شود، باید برای VAT ثبت‌نام کند. ثبت‌نام داوطلبانه از ۱۸۷,۵۰۰ درهم. نرخ استاندارد ۵٪.',
 '{all}', 'Track rolling 12-month taxable sales and alert the owner at alert_at_ratio of the mandatory threshold if not yet registered.',
 '{"vat_rate": 0.05, "mandatory_threshold_aed": 375000, "voluntary_threshold_aed": 187500, "lookback_months": 12, "lookahead_days": 30, "alert_at_ratio": 0.8}', 'Federal Decree-Law 8/2017 on VAT and its Executive Regulation', 'https://lookuptax.com/docs/country/uae-vat-guidelines-indirect-tax', 'confirmed', null, null, 'Check against the FTA registration page.'),

('VAT-PRICE-DISPLAY', 'vat', 'Prices shown including VAT', 'نمایش قیمت با VAT',
 'Prices shown to consumers should include VAT. To be confirmed against FTA guidance.',
 'قیمت‌هایی که به مصرف‌کننده نمایش داده می‌شود باید شامل VAT باشد. باید با راهنمای FTA تأیید شود.',
 '{all}', 'All public prices are VAT-inclusive. How margin-scheme invoices present VAT is decided under VAT-MARGIN-SCHEME.',
 '{"prices_include_vat": true}', 'FTA guidance (to verify)', 'https://www.uaeexperthub.com/?p=5764', 'unverified', null, null, null),

('VAT-DIGITAL-INVOICE', 'vat', 'Digital invoice for every online sale', 'فاکتور دیجیتال برای هر فروش آنلاین',
 'The e-commerce law requires a non-paper (digital) invoice. VAT-registered sellers issue tax invoices showing their TRN.',
 'قانون تجارت الکترونیک فاکتور غیرکاغذی (دیجیتال) را الزامی کرده است. فروشندهٔ ثبت‌نام‌شده در VAT فاکتور مالیاتی با شماره TRN صادر می‌کند.',
 '{all}', 'Generate a PDF invoice for every paid order, email it to the buyer and keep it for retention_years; include the TRN once registered.',
 '{"digital_invoice": true, "show_trn_when_registered": true, "retention_years": 5}', 'Federal Decree-Law 14/2023; Federal Decree-Law 8/2017 (tax invoices)', 'https://www.reedsmith.com/our-insights/blogs/viewpoints/102iqny/uae-federal-law-on-modern-trading-by-technological-means/', 'confirmed', null, null, null),

('VAT-MARGIN-SCHEME', 'vat', 'Profit margin scheme for pre-owned goods', 'طرح حاشیهٔ سود برای کالای دست‌دوم',
 'A VAT-registered reseller may charge VAT only on the margin (selling price minus purchase price, treated as VAT-inclusive; VAT = margin x 5/105) for second-hand goods, antiques over 50 years and collectors items that were previously subject to VAT. Use of the scheme must be notified to the FTA, and item-level records (stock book) kept.',
 'فروشندهٔ ثبت‌نام‌شده در VAT می‌تواند برای کالای دست‌دوم، عتیقهٔ بالای ۵۰ سال و کالای کلکسیونی که قبلاً مشمول VAT بوده، مالیات را فقط روی حاشیهٔ سود حساب کند (قیمت فروش منهای قیمت خرید، با احتساب مالیات؛ VAT = حاشیه × ۵/۱۰۵). استفاده از این طرح باید به FTA اعلام شود و سوابق تک‌تک کالاها (دفتر موجودی) نگه داشته شود.',
 '{pre_owned}', 'Keep the purchase price of each pre-owned item in a private table (never in products); compute VAT on the margin at sale; mark items bought from VAT-registered sellers with recovered input VAT as not eligible.',
 '{"vat_fraction_numerator": 5, "vat_fraction_denominator": 105, "requires_fta_notification": true, "requires_stock_book": true}', 'Federal Decree-Law 8/2017, Art. 43; VAT Executive Regulation, Art. 29; FTA guide VATGPM1 (January 2026)', 'https://www.dlapiper.com/insights/publications/gulf-tax-insights/2026/gulf-tax-insights-january-2026/uae-fta-issues-new-vat-guide-on-profit-margin-scheme', 'confirmed', null, null, null),

('EINV-B2B', 'e_invoicing', 'Mandatory e-invoicing for business customers', 'فاکتور الکترونیکی اجباری برای مشتریان تجاری',
 'E-invoicing through an Accredited Service Provider is mandatory for B2B and B2G transactions regardless of VAT registration: from 1 Jan 2027 for revenue of AED 50M or more, from 1 Jul 2027 for revenue below that. B2C sales are not currently in scope. Failing to implement or appoint an ASP on time costs AED 5,000 per month of delay.',
 'فاکتور الکترونیکی از طریق ارائه‌دهندهٔ معتبر (ASP) برای معاملات با شرکت‌ها و دولت اجباری است، چه ثبت‌نام VAT داشته باشید چه نه: از ۱ ژانویه ۲۰۲۷ برای درآمد ۵۰ میلیون درهم به بالا، از ۱ ژوئیه ۲۰۲۷ برای درآمد کمتر. فروش به مصرف‌کننده فعلاً شامل نیست. تأخیر در اجرا یا تعیین ASP ماهانه ۵,۰۰۰ درهم جریمه دارد.',
 '{b2b}', 'If the store sells to companies (corporate gifting, resellers), appoint an ASP before the go-live date and route B2B invoices through it. Consumer orders are unchanged.',
 '{"b2c_in_scope": false, "large_business_threshold_aed": 50000000, "large_go_live": "2027-01-01", "other_go_live": "2027-07-01", "late_penalty_aed_per_month": 5000}', 'Ministerial Decisions 243 and 244 of 2025', 'https://kpmg.com/us/en/taxnewsflash/news/2026/07/tnf-uae-phased-implementation-of-e-invoicing-beginning-january-1-2027.html', 'confirmed', '2027-07-01', null, 'The ASP appointment deadline for businesses under AED 50M falls before 1 Jul 2027; monitor to find the exact date.'),

('INS-COVERAGE', 'insurance', 'Insurance for digital traders and shipments', 'بیمه برای فروشندهٔ آنلاین و ارسال‌ها',
 'The e-commerce law (Art. 11-15) covers insurance by digital traders, logistics and digital payment entities to mitigate risks. Sources disagree on whether it is mandatory.',
 'قانون تجارت الکترونیک (مواد ۱۱ تا ۱۵) به پوشش بیمه‌ای فروشندگان دیجیتال، شرکت‌های لجستیک و پرداخت برای کاهش ریسک پرداخته است. منابع دربارهٔ اجباری بودن آن اختلاف دارند.',
 '{all}', 'Insure every shipment for its full value through the courier or a cargo policy; record the policy or cover reference on the order.',
 '{"insure_shipments_full_value": true}', 'Federal Decree-Law 14/2023, Art. 11-15', 'https://leap.unep.org/en/countries/ae/national-legislation/federal-decree-law-no-14-2023-concerning-modern-technology-based', 'needs_lawyer', null, null, null),

('AML-DPMS', 'aml', 'Anti-money-laundering for jewellery and watches with precious metals or stones', 'ضد پول‌شویی برای جواهر و ساعت دارای فلز یا سنگ قیمتی',
 'A dealer in precious metals or stones (including jewellery and watches containing them) is in AML scope for any single or linked cash transaction of AED 55,000 or more. It must register on goAML, do customer due diligence, and file a DPMSR for cash transactions with individuals and cash or wire transactions with companies at or above AED 55,000.',
 'فروشندهٔ فلز یا سنگ قیمتی (از جمله جواهر و ساعتی که آنها را دارد) برای هر معاملهٔ نقدی تکی یا مرتبط ۵۵ هزار درهم یا بیشتر مشمول قوانین ضد پول‌شویی است. باید در goAML ثبت‌نام کند، مشتری را احراز هویت کند، و برای معاملهٔ نقدی با اشخاص و معاملهٔ نقدی یا انتقال بانکی با شرکت‌ها از ۵۵ هزار درهم به بالا گزارش DPMSR ثبت کند.',
 '{precious_metals_stones}', 'Flag orders of precious-metal or precious-stone items at or above threshold_aed paid in cash by an individual, or paid by a company by cash or wire; require ID before fulfilment and create a DPMSR task for the owner.',
 '{"threshold_aed": 55000, "report": "DPMSR", "portal": "goAML", "covers": ["cash_individual", "cash_or_wire_company"]}', 'Federal Decree-Law 10/2025; Cabinet Resolution 134/2025, Art. 3(3); MoET Supplemental Guidance for DPMS 2026', 'https://www.moet.gov.ae/documents/20121/469920/Supplemental+Guidance+for+Dealers+in+Precious+Metals+%26+Stones+-+2026.pdf', 'confirmed', null, null, null),

('PRV-PDPL', 'privacy', 'Personal data protection', 'حفاظت از اطلاعات شخصی',
 'The PDPL (in force since 2 Jan 2022) makes consent the default basis for processing personal data, gives people rights over their data and requires breach reporting. Sources disagree on whether its Executive Regulations have been issued, which affects enforcement.',
 'قانون PDPL (اجرایی از ۲ ژانویه ۲۰۲۲) رضایت را مبنای اصلی پردازش اطلاعات شخصی قرار داده، به افراد حقوقی روی اطلاعاتشان می‌دهد و گزارش نشت اطلاعات را الزامی می‌کند. منابع دربارهٔ صدور آیین‌نامهٔ اجرایی آن اختلاف دارند که روی اجرای آن اثر دارد.',
 '{all}', 'Privacy policy page; cookie consent before analytics or marketing cookies; consent tick box on enquiry, concierge and newsletter forms; a way to request data deletion.',
 '{"cookie_consent": true, "privacy_policy": true, "consent_on_forms": true, "deletion_requests": true}', 'Federal Decree-Law 45/2021', 'https://www.businessdubai.ae/blogs/uae-pdpl-data-protection', 'disputed', '2022-01-02', null, null),

('SEC-ECOM', 'security', 'Secure trading environment', 'محیط امن معامله',
 'Digital traders must adopt secure technology infrastructure and meet e-security and cybersecurity requirements to protect transactions and customer data.',
 'فروشندگان دیجیتال باید زیرساخت فنی امن داشته باشند و الزامات امنیت الکترونیک و سایبری را برای حفاظت از معاملات و اطلاعات مشتری رعایت کنند.',
 '{all}', 'HTTPS everywhere; card payments only through a licensed payment gateway; no card data stored on the site.',
 '{"https": true, "licensed_payment_gateway": true, "store_card_data": false}', 'Federal Decree-Law 14/2023, Art. 5', 'https://hlc.com/en/publications/e-commerce-law-in-dubai', 'confirmed', null, null, null),

('ENF-PENALTIES', 'enforcement', 'E-commerce penalties schedule', 'جدول جریمه‌های تجارت الکترونیک',
 'Cabinet Resolution 200/2025 sets administrative violations and penalties under the e-commerce law; for some violations (for example the digital contract or terms) the first step is a written warning with up to 15 days to fix.',
 'مصوبهٔ ۲۰۰/۲۰۲۵ تخلفات و جریمه‌های قانون تجارت الکترونیک را تعیین کرده؛ برای بعضی تخلفات (مثل قرارداد یا شرایط دیجیتال) قدم اول اخطار کتبی با حداکثر ۱۵ روز مهلت اصلاح است.',
 '{all}', 'Any warning received from MoET or DET is logged and fixed within the stated period.',
 '{"warning_fix_days": 15}', 'Cabinet Resolution 200/2025', 'https://uaelegislation.gov.ae/en/legislations/3989', 'confirmed', null, null, null);
