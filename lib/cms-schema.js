/**
 * Everything editable from Admin → Content.
 *
 * Each field's key matches a data-cms="key" attribute in index.html (or, for
 * shop cards and settings, is read by the page's script). Starting values are
 * taken from index.html itself by scripts/extract-defaults.js, so the editor
 * always opens with what the page shows.
 *
 * type: text (one line), long (paragraph), lines (one item per line),
 *       number, bool
 */
const f = (key, label, type = 'text', help) => ({ key, label, type, ...(help ? { help } : {}) });

const SKUS = [
  ['single-500', 'Single 500 mL'], ['day-500', 'Day Pack (4 × 500 mL)'], ['case-500', 'Case of 24 × 500 mL'],
  ['single-2000', 'Single 2 L'], ['case-2000', 'Case of 6 × 2 L'], ['case5-2000', '5 cases (30 × 2 L)'],
];

export const CMS_GROUPS = [
  { id: 'announce', title: 'Announcement bar', note: 'A thin bar above the menu, for news such as free delivery.', fields: [
    f('announce.enabled', 'Show the announcement bar', 'bool'),
    f('announce.text', 'Announcement text'),
  ] },
  { id: 'hero', title: 'Top of the page (hero)', fields: [
    f('hero.eyebrow', 'Small label above the title'),
    f('hero.tagline1', 'Tagline, first part'),
    f('hero.tagline2', 'Tagline, second part (in blue italics)'),
    f('hero.lede', 'Introduction', 'long'),
    f('hero.cta_shop', 'Shop button'),
    f('hero.cta_science', 'Science button'),
    f('hero.sale_show', 'Show the sale price tag', 'bool'),
    f('hero.sale_badge', 'Sale tag label'),
    f('hero.sale_text', 'Sale tag text'),
    f('hero.sale_was', 'Sale tag crossed-out price'),
    f('hero.fact1_value', 'Fact card 1: big text'),
    f('hero.fact1_label', 'Fact card 1: small text'),
    f('hero.fact2_value', 'Fact card 2: big text'),
    f('hero.fact2_label', 'Fact card 2: small text'),
  ] },
  { id: 'marquee', title: 'Scrolling benefits strip', fields: [
    f('marquee.items', 'Items, one per line', 'lines'),
  ] },
  { id: 'ing', title: "What's inside (benefits)", fields: [
    f('ing.eyebrow', 'Section label'),
    f('ing.title1', 'Title, first part'),
    f('ing.title2', 'Title, second part (in blue italics)'),
    f('ing.lede', 'Introduction', 'long'),
    ...[1, 2, 3, 4].flatMap((n) => [
      f(`ing.c${n}.title`, `Card ${n}: benefit`),
      f(`ing.c${n}.pill`, `Card ${n}: mineral label`),
      f(`ing.c${n}.text`, `Card ${n}: description`, 'long'),
      f(`ing.c${n}.bn`, `Card ${n}: Bangla line`),
    ]),
  ] },
  { id: 'sci', title: 'The science', fields: [
    f('sci.eyebrow', 'Section label'),
    f('sci.title', 'Title'),
    f('sci.lede', 'Introduction', 'long'),
    ...[1, 2].flatMap((n) => [
      f(`sci.c${n}.role`, `Partner ${n}: role`),
      f(`sci.c${n}.title`, `Partner ${n}: name`),
      f(`sci.c${n}.text`, `Partner ${n}: description`, 'long'),
    ]),
    f('sci.also', 'Line under the partner cards'),
    ...[1, 2, 3].flatMap((n) => [
      f(`sci.s${n}.title`, `Timeline step ${n}: title`),
      f(`sci.s${n}.text`, `Timeline step ${n}: text`),
      f(`sci.s${n}.tag`, `Timeline step ${n}: status`),
    ]),
  ] },
  { id: 'pre', title: 'Preclinical studies', fields: [
    f('pre.eyebrow', 'Label'),
    f('pre.title', 'Title'),
    f('pre.text', 'Text', 'long'),
    f('pre.stat1.value', 'Figure 1: number'), f('pre.stat1.label', 'Figure 1: label'),
    f('pre.stat2.value', 'Figure 2: number'), f('pre.stat2.label', 'Figure 2: label'),
  ] },
  { id: 'trial', title: 'Clinical trial', note: 'The chart itself is drawn from fixed numbers; ask a developer to change it.', fields: [
    f('trial.eyebrow', 'Label'),
    f('trial.badge', 'Review badge'),
    f('trial.title', 'Title'),
    f('trial.big', 'Headline number'),
    f('trial.unit', 'Headline unit'),
    f('trial.vs', 'Headline comparison'),
    f('trial.big_label', 'What the headline measures'),
    f('trial.pct', 'Percentage badge'),
    f('trial.fine', 'Footnote', 'long'),
    ...[1, 2, 3].flatMap((n) => [
      f(`trial.st${n}.value`, `Study fact ${n}: number`),
      f(`trial.st${n}.label`, `Study fact ${n}: label`),
      f(`trial.st${n}.small`, `Study fact ${n}: detail`),
    ]),
    f('trial.chart_title', 'Chart title'),
    f('trial.chart_sub', 'Chart subtitle'),
    f('trial.chart_fine', 'Chart footnote'),
    f('more.title', 'More results: heading'),
    ...[1, 2, 3, 4, 5].flatMap((n) => [
      f(`more.${n}.value`, `Result ${n}: number`),
      f(`more.${n}.unit`, `Result ${n}: unit`),
      f(`more.${n}.label`, `Result ${n}: measure`),
      f(`more.${n}.small`, `Result ${n}: detail`),
    ]),
    f('ctx.title', 'About the study: heading'),
    f('ctx.text', 'About the study: text', 'long'),
    f('disclaimer', 'Disclaimer', 'long'),
  ] },
  { id: 'shop', title: 'Shop section', fields: [
    f('shop.eyebrow', 'Section label'),
    f('shop.title', 'Title'),
    f('shop.lede', 'Introduction', 'long'),
    f('shop.trust1', 'Note under the cards 1'),
    f('shop.trust2', 'Note under the cards 2'),
    f('shop.trust3', 'Note under the cards 3'),
  ] },
  { id: 'plans', title: 'Shop cards', note: 'Prices are edited under Products & prices.', fields: SKUS.flatMap(([sku, name]) => [
    f(`plans.${sku}.title`, `${name}: title`),
    f(`plans.${sku}.sub`, `${name}: description`),
    f(`plans.${sku}.badge`, `${name}: badge (leave empty for none)`),
    f(`plans.${sku}.bullet1`, `${name}: point 1`),
    f(`plans.${sku}.bullet2`, `${name}: point 2`),
    f(`plans.${sku}.button`, `${name}: button`),
  ]) },
  { id: 'footer', title: 'Footer', fields: [
    f('footer.headline1', 'Headline, first part'),
    f('footer.headline2', 'Headline, second part'),
    f('footer.copyright', 'Copyright line'),
  ] },
  { id: 'order', title: 'Ordering', note: 'These settings control checkout.', fields: [
    f('order.delivery_fee', 'Delivery charge (Tk)', 'number'),
    f('order.free_over', 'Free delivery for orders of at least (Tk, 0 = never free)', 'number'),
    f('order.cod_enabled', 'Accept cash on delivery', 'bool'),
    f('order.online_enabled', 'Accept online payment (only works once a gateway is connected)', 'bool'),
    f('order.areas', 'Delivery areas offered at checkout, one per line (leave empty to let customers type their city)', 'lines'),
    f('order.thanks', 'Message after a cash-on-delivery order', 'long'),
  ] },
];

export const CMS_FIELDS = Object.fromEntries(CMS_GROUPS.flatMap((g) => g.fields.map((x) => [x.key, x])));

// Values that are not visible text on the page, so they cannot be read from index.html.
export const NON_PAGE_DEFAULTS = {
  'announce.enabled': false,
  'announce.text': '',
  'hero.sale_show': true,
  'order.delivery_fee': 0,
  'order.free_over': 0,
  'order.cod_enabled': true,
  'order.online_enabled': true,
  'order.areas': '',
  'order.thanks': "Thank you! We'll call you shortly to confirm your order and delivery time.",
};
