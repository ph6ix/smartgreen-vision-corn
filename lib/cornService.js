/**
 * Corn Leaf Doctor — AI analysis service
 * วิเคราะห์ธาตุอาหาร โรค และแมลงศัตรูข้าวโพดจากภาพใบและต้น
 *
 * ความรู้อ้างอิงในคำสั่ง AI ด้านล่างเป็น "ร่าง" จากหลักวิชาการทั่วไป
 * ต้องให้ทีมนักวิชาการสมาร์ทกรีนตรวจทานก่อนใช้งานจริง
 */
import { isBusyError, BUSY_MESSAGE_TH } from './modelRetry.js';
import { generateJsonWithFallback, normalizeSmartGreenProductText } from './gemini.js';
import { getEnabledCornProducts, matchCornProduct } from './cornProducts.js';

// ตำแหน่งภาพที่รับ (3 ภาพบังคับ + 1 ภาพเสริม)
export const CORN_IMAGE_SLOTS = [
  { key: 'young', label: 'ใบอ่อน / ยอด (ใบที่ยังม้วนในกรวยยอด)', required: true },
  { key: 'mature', label: 'ใบมาตรฐาน (ใบบนสุดที่เห็นปลอกใบชัด หรือใบตรงข้อฝักช่วงออกไหม)', required: true },
  { key: 'old', label: 'ใบล่าง / ใบแก่', required: true },
  { key: 'tree', label: 'ทั้งต้น / ฝัก / ลำต้น (ไม่บังคับ)', required: false },
];

export const CORN_NUTRIENTS = [
  { code: 'N', name: 'ไนโตรเจน (N)' },
  { code: 'P', name: 'ฟอสฟอรัส (P)' },
  { code: 'K', name: 'โพแทสเซียม (K)' },
  { code: 'Mg', name: 'แมกนีเซียม (Mg)' },
  { code: 'S', name: 'กำมะถัน (S)' },
  { code: 'Zn', name: 'สังกะสี (Zn)' },
  { code: 'B', name: 'โบรอน (B)' },
  { code: 'Mn', name: 'แมงกานีส (Mn)' },
];

const STATUS_LEVELS = ['ปกติ', 'เสี่ยงขาด', 'ขาดเล็กน้อย', 'ขาดปานกลาง', 'ขาดรุนแรง', 'ต้องตรวจเพิ่ม'];
const LIKELIHOODS = ['สูง', 'ปานกลาง', 'ต่ำ'];

function buildProductSection() {
  const products = getEnabledCornProducts();
  if (!products.length) {
    return 'ผลิตภัณฑ์สมาร์ทกรีน: ยังไม่มีรายการสำหรับข้าวโพด ให้ตอบ "smart_green_products": []';
  }
  const lines = products.map(p =>
    `  * ${p.name}: ${p.description} (ช่วยเรื่อง: ${p.fixes.join(', ')})${p.usage ? ` — อัตราใช้: ${p.usage}` : ''}`
  );
  return `ผลิตภัณฑ์สมาร์ทกรีน (SMART GREEN) ที่อนุญาตให้แนะนำเสริม:
${lines.join('\n')}
กติกา: แนะนำได้เฉพาะชื่อในรายการนี้ 0-3 รายการ ที่ตรงกับปัญหาที่พบจริงเท่านั้น ห้ามคิดชื่อหรือสูตรใหม่
ห้ามระบุอัตราใช้เองหากรายการไม่ได้ให้อัตราไว้ ให้เขียนว่า "ใช้ตามอัตราบนฉลาก" ผลิตภัณฑ์เหล่านี้เป็นตัวเสริม ไม่ใช่ตัวแทนแผนปุ๋ยหลัก
หากต้นสมบูรณ์ดีหรือไม่มีรายการที่ตรงปัญหา ให้ตอบ []`;
}

export function buildCornPrompt(payload) {
  const hasTree = Boolean(payload.images && payload.images.tree);
  const observed = Array.isArray(payload.observedSymptoms) && payload.observedSymptoms.length
    ? payload.observedSymptoms.join(', ')
    : '-';

  return `
คุณคือระบบ "Vision Ai วิเคราะห์ใบข้าวโพด" ผู้เชี่ยวชาญด้านธาตุอาหารพืช โรคพืช และแมลงศัตรูข้าวโพดเลี้ยงสัตว์ (Zea mays) ในประเทศไทย"

ขั้นตอนที่ 1 — ตรวจสอบความถูกต้องของภาพ (บังคับ):
- ภาพต้องเป็นใบ/ยอด/ลำต้น/ฝัก/ทั้งต้นของ "ข้าวโพด" (ใบยาวเรียวแบบใบหญ้า เส้นกลางใบสีขาวชัด ลำต้นมีข้อปล้อง ใบเรียงสลับ 2 ข้าง)
- ดูจากภาพจริงเท่านั้น ห้ามใช้ข้อมูลแปลงหรืออาการที่ผู้ใช้กรอกมาแทนภาพ ข้อมูลแปลงใช้ประกอบการวินิจฉัยหลังจากภาพผ่านการตรวจแล้วเท่านั้น
- ให้บรรยายสิ่งที่เห็นจริงในแต่ละภาพลงใน "image_checks" ก่อนเสมอ
- ภาพถ่ายจริงจากแปลงที่เห็นใบหรือต้นเพียงบางส่วน หรือมีพื้นหลังรก ถือว่าผ่าน
- หากภาพใดไม่ใช่พืชนี้ (เช่น คน สัตว์ สิ่งของ เอกสาร หน้าจอ ภาพวาด/ภาพกราฟิก ภาพสีพื้นทึบ ใบพืชชนิดอื่น เช่น อ้อย ข้าวฟ่าง หญ้า ข้าว ข้าวโพด) หรือมืด/เบลอจนวิเคราะห์ไม่ได้ ให้ตอบ
  "is_corn": false และ "invalid_image_reason" ระบุอย่างสุภาพว่าภาพตำแหน่งใดไม่ถูกต้อง พร้อมแนะนำให้ถ่ายใหม่ (ฟิลด์อื่นใส่ค่าว่างได้)
- หากถูกต้องให้ตอบ "is_corn": true, "invalid_image_reason": ""

ขั้นตอนที่ 2 — ภาพที่ได้รับ (เรียงตามลำดับ):
1) ใบอ่อน / ยอด (ใบในกรวยยอดและใบที่เพิ่งคลี่) — ดูธาตุที่เคลื่อนย้ายยาก: Zn, S, B, Mn และโรคราน้ำค้าง หนอนกระทู้ข้าวโพดลายจุดในกรวยยอด
2) ใบมาตรฐาน — ต้นเล็ก (ก่อนออกดอก) ใช้ใบบนสุดที่เห็นปลอกใบ (collar) ชัด; ช่วงออกไหมใช้ใบตรงข้อฝัก — ภาพตัวแทนสถานะธาตุอาหารของต้น
3) ใบล่าง / ใบแก่ — ดูธาตุที่เคลื่อนย้ายได้: N, P, K, Mg และโรคใบไหม้ ราสนิม
${hasTree ? '4) ทั้งต้น / ฝัก / ลำต้น — ใช้ดูทรงต้น ความสูง ลำต้นหักล้ม รูหนอนเจาะ ลำต้นเน่า ฝักไม่เต็ม/ไม่ติดเมล็ด' : '(ไม่มีภาพทั้งต้น/ฝัก/ลำต้น ให้ระบุ tree_analysis ว่า "ไม่มีภาพ")'}

ความรู้อ้างอิงอาการขาดธาตุของข้าวโพด:
- N: (พบบ่อยที่สุด) ใบล่างเหลืองเป็นรูปตัววี (V) จากปลายใบเข้าตามเส้นกลางใบ ต้นเตี้ย ลำต้นเล็ก ฝักเล็กปลายฝักไม่มีเมล็ด
- P: ต้นเล็กอายุ 2-6 สัปดาห์ ใบมีสีม่วงแดงที่ขอบใบและปลายใบ (โดยเฉพาะอากาศเย็น/ดินกรด) ต้นแคระแกร็น ฝักบิดเบี้ยว
- K: ขอบใบล่างเหลืองแล้วไหม้เป็นสีน้ำตาลจากปลายใบไล่ลงมาตามขอบใบ (เส้นกลางใบยังเขียว) ลำต้นอ่อนแอ หักล้มง่าย ปลายฝักไม่เต็ม
- Mg: ใบล่างเหลืองเป็นแถบระหว่างเส้นใบ เส้นใบยังเขียว (ลายทาง) ขอบใบอาจมีสีม่วงแดง (ดินทราย/ดินกรด)
- S: ใบอ่อน/ใบบนเหลืองซีดทั้งใบ (ต่างจาก N ที่เริ่มจากใบล่าง) อาจมีลายทางจาง ๆ
- Zn: (พบบ่อยในดินด่าง/ดินร่วนปนปูน) ใบอ่อนมีแถบสีขาวหรือเหลืองซีดกว้างสองข้างเส้นกลางใบช่วงโคนใบ ข้อปล้องสั้น ต้นเตี้ย
- B: ใบอ่อนมีจุดหรือแถบสีขาวใสไม่สม่ำเสมอระหว่างเส้นใบ ไหมออกไม่ดี ฝักติดเมล็ดไม่สม่ำเสมอ
- Mn: ใบอ่อน/ใบกลางเหลืองซีดระหว่างเส้นใบเป็นสีเขียวมะกอก (ดินด่าง/ดินที่ใส่ปูนมาก)

ความรู้อ้างอิงโรคและแมลงสำคัญของข้าวโพด:
- หนอนกระทู้ข้าวโพดลายจุด (Fall armyworm, Spodoptera frugiperda): ใบมีรอยกัดเป็นรูขาดวิ่น/รอยขูดผิวใบเป็นแผ่นใส มีมูลหนอนเป็นขุยในกรวยยอด ระบาดในไทยตั้งแต่ปี 2561 — รุนแรง ต้องจัดการเร็วช่วงต้นเล็ก
- โรคราน้ำค้าง (Downy mildew, Peronosclerospora): ใบมีทางสีเหลืองซีดหรือขาวยาวขนานเส้นใบ ใต้ใบมีผงสีขาวช่วงเช้า ต้นแคระแกร็น ไม่ติดฝัก — รุนแรง พบในต้นอายุน้อย ต้องถอนต้นที่เป็นโรคทำลาย
- โรคใบไหม้แผลใหญ่ (Northern leaf blight, Exserohilum turcicum): แผลยาวรีรูปกระสวย/ซิการ์ สีเทาอมเขียวถึงน้ำตาล ยาว 2.5-15 ซม.
- โรคใบไหม้แผลเล็ก (Southern leaf blight, Bipolaris maydis): แผลเล็กรีสีน้ำตาล ขอบสีเข้ม อยู่ระหว่างเส้นใบ
- โรคราสนิม (Southern rust, Puccinia polysora): ตุ่มผงสีส้มถึงน้ำตาลแดงขนาดเล็กกระจายบนผิวใบ
- โรคใบจุดสีเทา / ใบจุดสีน้ำตาล: แผลสี่เหลี่ยมผืนผ้าสีเทาตามเส้นใบ
- หนอนเจาะลำต้นข้าวโพด (Asian corn borer, Ostrinia furnacalis): ใบมีรูเรียงเป็นแถว ลำต้นมีรูเจาะและขุย ช่อดอกหัก ลำต้นหักล้ม
- โรคลำต้นเน่า (Stalk rot): ลำต้นช่วงโคนนิ่มเปลี่ยนสี ต้นหักล้มก่อนเก็บเกี่ยว
- เพลี้ยอ่อน / เพลี้ยไฟ / ไรแดง: ใบซีด ใบหงิก มีราดำ (ช่วงแล้ง)
- อาการจากสารกำจัดวัชพืช: ใบอ่อนเหลือง ขาว หรือบิดม้วนผิดรูปหลังพ่นยา — ต้องแยกจากการขาดธาตุ
- ความเครียดจากภาวะแล้ง: ใบม้วนเป็นหลอดช่วงกลางวัน ใบสีเขียวเทา ปลายใบแห้ง — ต้องแยกจากการขาด K (แล้งมักเป็นทั้งแปลงพร้อมกัน)

${buildProductSection()}

ข้อมูลแปลงจากผู้ใช้:
- ชื่อเกษตรกร / แปลง: ${payload.customerName || '-'}
- ผู้ตรวจ / ผู้ดูแล: ${payload.inspectorName || '-'}
- อายุหลังปลูก: ${payload.plantAge || '-'} วัน
- ฤดูปลูก: ${payload.plantingSeason || '-'}
- พันธุ์: ${payload.variety || '-'}
- จังหวัด: ${payload.province || '-'}
- พิกัดแปลง (GPS): ${payload.coordinates || '-'}
- ชนิดดิน: ${payload.soilType || '-'}
- สภาพน้ำ/ความชื้น: ${payload.waterStatus || '-'}
- ค่า pH ดิน: ${payload.soilPh || 'ไม่ได้วัด'}
- ผลผลิตรอบก่อน: ${payload.yieldPerRai || '-'} กก./ไร่
- ปุ๋ยที่ใส่ล่าสุด: ${payload.lastFertilizer || '-'}
- อาการที่ผู้ใช้สังเกตเห็นในแปลง: ${observed}
- หมายเหตุเพิ่มเติม: ${payload.notes || '-'}

กติกาการวิเคราะห์:
1. ห้ามฟันธงจากภาพอย่างเดียว ใช้ความต่างระหว่างใบอ่อน / ใบมาตรฐาน / ใบล่าง และข้อมูลแปลงประกอบ
2. แยกอาการขาดธาตุ ออกจากโรค แมลง ความเครียดน้ำ และอาการจากสารเคมี (เช่น สารกำจัดวัชพืช) ให้ชัดเจน
3. หากไม่มั่นใจ ให้ระบุสถานะ "ต้องตรวจเพิ่ม" และแนะนำวิธีตรวจ (เก็บใบมาตรฐานส่งวิเคราะห์ห้องแล็บ / ตรวจดิน)
4. ต้องประเมินธาตุครบทั้ง 8 ตัว: N, P, K, Mg, S, Zn, B, Mn โดยสถานะเลือกจาก: ${STATUS_LEVELS.join(' | ')}
5. ภาษาไทย อ่านง่าย ใช้ได้จริงสำหรับเกษตรกร
6. ตอบเป็น JSON เท่านั้น

แนวทางคำแนะนำปุ๋ย (ต่อไร่ ปรับตามผลวิเคราะห์ดินและชนิดดิน):
- รองพื้นตอนปลูก: สูตร 16-20-0 หรือ 15-15-15 อัตรา 25-50 กก./ไร่ (ดินทราย/ดินร่วนปนทรายใช้ 15-15-15 หรือ 16-16-8)
- แต่งหน้า: ยูเรีย 46-0-0 อัตรา 15-25 กก./ไร่ เมื่อข้าวโพดอายุ 25-30 วัน (มีใบ 6-8 ใบ) โรยข้างแถวแล้วพรวนกลบ ขณะดินมีความชื้น
- โพแทสเซียม (ดินทราย/ขาด K): 0-0-60 อัตรา 10-20 กก./ไร่ พร้อมปุ๋ยรองพื้น
- สังกะสี: ซิงค์ซัลเฟต 2-3 กก./ไร่ ทางดิน หรือพ่นซิงค์ซัลเฟต 0.5% ทางใบ 1-2 ครั้งช่วงอายุ 15-35 วัน
- กำมะถัน: ใช้แอมโมเนียมซัลเฟต 21-0-0 แทนยูเรียบางส่วน
- หลังข้าวโพดออกไหมแล้ว การใส่ปุ๋ยทางดินได้ผลน้อย ให้เน้นแก้โรค/แมลงและวางแผนปุ๋ยรอบถัดไป
- หากดินแห้ง/ฝนทิ้งช่วง: รอฝนหรือให้น้ำก่อนใส่ปุ๋ย ห้ามใส่ขณะดินแห้ง
- หนอนกระทู้: สำรวจกรวยยอดสัปดาห์ละ 1-2 ครั้งช่วงอายุ 7-45 วัน หากพบเกิน 20% ของต้นให้พ่นสารตามคำแนะนำกรมวิชาการเกษตร หยอดลงกรวยยอด สลับกลุ่มสารเพื่อป้องกันดื้อยา

ให้ตอบเป็น JSON โครงสร้างนี้เท่านั้น:
{
  "image_checks": [
    { "slot": "young", "is_corn": true, "seen": "สิ่งที่เห็นจริงในภาพนี้ 1 ประโยค" }
  ],
  "is_corn": true,
  "invalid_image_reason": "",
  "young_leaf_analysis": "สรุปอาการใบอ่อน/ใบยอด 1-2 ประโยค",
  "mature_leaf_analysis": "สรุปอาการใบมาตรฐาน 1-2 ประโยค",
  "old_leaf_analysis": "สรุปอาการใบล่าง 1-2 ประโยค",
  "tree_analysis": "สรุปจากภาพทั้งต้น/ฝัก/ลำต้น หรือ 'ไม่มีภาพ'",
  "health_score": 75,
  "primary_issue": "ปัญหาหลักสั้นๆ เช่น ขาดไนโตรเจน (N) ระดับปานกลาง",
  "overall_summary": "สรุปภาพรวม 2-4 ประโยค ข้อสันนิษฐานและเหตุผล",
  "nutrient_status": [
    { "code": "N", "status": "ปกติ", "evidence": "เหตุผล/อาการที่เห็นสั้นๆ" }
  ],
  "diseases": [
    { "name": "ชื่อโรคหรือแมลง", "type": "โรค หรือ แมลง หรือ ความเครียด", "likelihood": "สูง|ปานกลาง|ต่ำ", "evidence": "อาการที่เห็น", "management": "วิธีจัดการที่ทำได้จริง" }
  ],
  "fertilizer_plan": [
    { "nutrient": "N", "product": "ยูเรีย 46-0-0", "rate": "20 กก./ไร่", "timing": "ข้าวโพดอายุ 25-30 วัน ขณะดินชื้น", "method": "โรยข้างแถวแล้วพรวนกลบ" }
  ],
  "smart_green_products": [
    { "name": "ชื่อผลิตภัณฑ์จากรายการที่อนุญาตเท่านั้น", "reason": "ช่วยแก้ปัญหาที่พบอย่างไร 1 ประโยค", "usage": "วิธีใช้/อัตรา (ถ้าไม่มีข้อมูลให้เขียน 'ใช้ตามอัตราบนฉลาก')" }
  ],
  "urgent_actions": ["สิ่งที่ควรทำทันทีภายใน 1-2 สัปดาห์"],
  "recommended_next_step": "ขั้นตอนถัดไป เช่น เก็บใบมาตรฐานส่งวิเคราะห์ ตรวจซ้ำใน 2 สัปดาห์",
  "confidence": "สูง|ปานกลาง|ต่ำ"
}
หมายเหตุ: "diseases" ให้ใส่เฉพาะที่มีหลักฐานจากภาพหรือข้อมูลแปลง หากไม่พบให้เป็น [] ; "health_score" 0-100 (100 = สมบูรณ์มาก)
`.trim();
}

function asString(v, fallback = '-') {
  if (v === null || v === undefined) return fallback;
  const s = String(v).trim();
  return s || fallback;
}

function pickEnum(value, allowed, fallback) {
  const s = asString(value, '');
  return allowed.find(a => s === a) || allowed.find(a => s.includes(a)) || fallback;
}

/** Normalize the AI reply into a predictable shape for the frontend. */
export function normalizeCornResult(parsed, payload) {
  const p = parsed && typeof parsed === 'object' ? parsed : {};

  const nutrientMap = new Map();
  for (const item of Array.isArray(p.nutrient_status) ? p.nutrient_status : []) {
    if (!item || typeof item !== 'object') continue;
    const code = asString(item.code || item.nutrient, '').replace(/[^A-Za-z]/g, '');
    const match = CORN_NUTRIENTS.find(n => n.code.toLowerCase() === code.toLowerCase());
    if (match) nutrientMap.set(match.code, item);
  }
  const nutrientStatus = CORN_NUTRIENTS.map(n => {
    const item = nutrientMap.get(n.code) || {};
    return {
      code: n.code,
      name: n.name,
      status: pickEnum(item.status, STATUS_LEVELS, 'ต้องตรวจเพิ่ม'),
      evidence: asString(item.evidence, 'ไม่พบข้อมูลจากภาพ'),
    };
  });

  const diseases = (Array.isArray(p.diseases) ? p.diseases : [])
    .filter(d => d && typeof d === 'object' && d.name)
    .map(d => ({
      name: asString(d.name),
      type: asString(d.type, 'โรค'),
      likelihood: pickEnum(d.likelihood, LIKELIHOODS, 'ต่ำ'),
      evidence: asString(d.evidence),
      management: asString(d.management),
    }));

  const fertilizerPlan = (Array.isArray(p.fertilizer_plan) ? p.fertilizer_plan : [])
    .filter(f => f && typeof f === 'object' && (f.product || f.nutrient))
    .map(f => ({
      nutrient: asString(f.nutrient, ''),
      product: asString(f.product),
      rate: asString(f.rate),
      timing: asString(f.timing),
      method: asString(f.method),
    }));

  const seenProducts = new Set();
  const smartGreenProducts = [];
  for (const item of Array.isArray(p.smart_green_products) ? p.smart_green_products : []) {
    if (!item || typeof item !== 'object') continue;
    const product = matchCornProduct(normalizeSmartGreenProductText(asString(item.name, '')));
    if (!product || seenProducts.has(product.key)) continue; // drop anything not on the approved list
    seenProducts.add(product.key);
    smartGreenProducts.push({
      key: product.key,
      name: product.name,
      image: product.image,
      reason: normalizeSmartGreenProductText(asString(item.reason, product.description)),
      // Only show rates the technical team approved in cornProducts.js — never AI-invented ones
      usage: product.usage || 'ใช้ตามอัตราบนฉลาก',
    });
  }

  let score = parseInt(p.health_score, 10);
  if (Number.isNaN(score)) score = 60;
  score = Math.max(0, Math.min(100, score));

  const urgent = Array.isArray(p.urgent_actions)
    ? p.urgent_actions.map(a => asString(a, '')).filter(Boolean)
    : (p.urgent_actions ? [asString(p.urgent_actions)] : []);

  return {
    success: true,
    crop: 'corn',
    customerName: payload.customerName || '',
    inspectorName: payload.inspectorName || '',
    plantAge: payload.plantAge || '',
    plantingSeason: payload.plantingSeason || '',
    variety: payload.variety || '',
    province: payload.province || '',
    coordinates: payload.coordinates || '',
    soilType: payload.soilType || '',
    waterStatus: payload.waterStatus || '',
    soilPh: payload.soilPh || 'ไม่ได้วัด',
    yieldPerRai: payload.yieldPerRai || '',
    lastFertilizer: payload.lastFertilizer || '',
    observedSymptoms: Array.isArray(payload.observedSymptoms) ? payload.observedSymptoms : [],
    youngLeafAnalysis: asString(p.young_leaf_analysis),
    matureLeafAnalysis: asString(p.mature_leaf_analysis),
    oldLeafAnalysis: asString(p.old_leaf_analysis),
    treeAnalysis: asString(p.tree_analysis, 'ไม่มีภาพ'),
    healthScore: score,
    primaryIssue: asString(p.primary_issue, 'ต้องตรวจเพิ่ม'),
    overallSummary: asString(p.overall_summary),
    nutrientStatus,
    diseases,
    fertilizerPlan,
    smartGreenProducts,
    urgentActions: urgent,
    recommendedNextStep: asString(p.recommended_next_step),
    confidence: pickEnum(p.confidence, LIKELIHOODS, 'ปานกลาง'),
  };
}

/** Returns an error message (Thai) when the payload is invalid, otherwise null. */
export function validateCornPayload(payload) {
  if (!payload || typeof payload !== 'object' || !payload.images) {
    return 'ไม่พบข้อมูลรูปภาพ';
  }
  const missing = CORN_IMAGE_SLOTS
    .filter(s => s.required && !(payload.images[s.key] && payload.images[s.key].base64))
    .map(s => s.label);
  if (missing.length) {
    return `กรุณาอัปโหลดรูปให้ครบ: ${missing.join(', ')}`;
  }
  return null;
}

/** Labels of submitted image slots the model marked as not-corn in image_checks. */
export function failedImageChecks(parsed, payload) {
  const checks = parsed && Array.isArray(parsed.image_checks) ? parsed.image_checks : [];
  return CORN_IMAGE_SLOTS
    .filter((slot) => payload.images && payload.images[slot.key])
    .filter((slot) => checks.some((c) => c && c.slot === slot.key && (c.is_corn === false || c.is_corn === 'false')))
    .map((slot) => slot.label);
}

const PRECHECK_PROMPT = `
ตรวจภาพแต่ละภาพด้านบนอย่างเข้มงวด โดยดูจากภาพเท่านั้น (ไม่มีข้อมูลอื่นประกอบ)
ภาพผ่านได้เมื่อเป็น "ภาพถ่ายจริง" ที่เห็นส่วนของต้นข้าวโพดชัดเจน: ใบ ยอด ลำต้น ฝัก ช่อดอก หรือทั้งต้น
(ใบข้าวโพดยาวเรียวแบบใบหญ้า เส้นกลางใบสีขาวชัด ใบกว้างกว่าใบข้าวและใบอ้อย; ภาพแปลงจริงที่มีพื้นหลังรกหรือเห็นต้นข้าวโพดเพียงบางส่วนถือว่าผ่าน)
ภาพไม่ผ่าน: ภาพวาด ภาพกราฟิก ลวดลาย/รูปทรงเรขาคณิต ภาพสีพื้น ภาพหน้าจอ เอกสาร คน สัตว์ สิ่งของ
พืชชนิดอื่น (อ้อย ข้าวฟ่าง ข้าว หญ้า ข้าวโพด ฯลฯ) หรือภาพมืด/เบลอจนมองไม่เห็นใบหรือต้น
ตอบ JSON เท่านั้น: {"image_checks":[{"slot":"young","is_corn":true,"seen":"สิ่งที่เห็นจริงในภาพ 1 ประโยค"}]}
`.trim();

function imageParts(payload) {
  const parts = [];
  for (const slot of CORN_IMAGE_SLOTS) {
    const img = payload.images[slot.key];
    if (img && img.base64) {
      parts.push({ text: `ภาพ slot="${slot.key}": ${slot.label}` });
      parts.push({ inlineData: { mimeType: img.mimeType || 'image/jpeg', data: img.base64 } });
    }
  }
  return parts;
}

/**
 * Step 1: judge the photos alone, without the farmer's text. With symptoms in the prompt the
 * model tends to "see" them in any image, so this check must not see the context.
 * Returns labels of failed slots; fails open (returns []) if the check itself errors or times out.
 */
export async function precheckImages(payload, traceId) {
  try {
    const parsed = await generateJsonWithFallback([...imageParts(payload), { text: PRECHECK_PROMPT }],
      `${traceId}-precheck`, { timeoutMs: 12000, totalBudgetMs: 18000 });
    const failed = failedImageChecks(parsed, payload);
    if (failed.length) console.warn(`[${traceId}] precheck rejected:`, JSON.stringify(parsed.image_checks));
    return failed;
  } catch (err) {
    console.warn(`[${traceId}] precheck skipped:`, err.message);
    return [];
  }
}

export async function analyzeCorn(payload, traceId) {
  const rejected = await precheckImages(payload, traceId);
  if (rejected.length) {
    const err = new Error(`ภาพตำแหน่ง ${rejected.join(', ')} ไม่ใช่ภาพถ่ายข้าวโพดที่วิเคราะห์ได้ กรุณาถ่ายภาพใบข้าวโพดจริงใหม่อีกครั้ง`);
    err.isInvalidImage = true;
    throw err;
  }

  // Images go first (each labelled with its slot key) so the model looks at the photos
  // before it reads the farmer's context, which otherwise invites made-up findings.
  const contents = [...imageParts(payload), { text: buildCornPrompt(payload) }];

  const parsed = await generateJsonWithFallback(contents, traceId, { timeoutMs: 22000, totalBudgetMs: 38000 });

  const failed = failedImageChecks(parsed, payload);
  if (parsed && (parsed.is_corn === false || failed.length)) {
    const err = new Error(
      parsed.invalid_image_reason ||
      (failed.length ? `ภาพตำแหน่ง ${failed.join(', ')} ไม่ใช่ภาพข้าวโพดที่วิเคราะห์ได้ กรุณาถ่ายภาพใหม่อีกครั้ง` : '') ||
      'ระบบตรวจพบว่าภาพที่อัปโหลดไม่ใช่ข้าวโพด กรุณาถ่ายภาพใบข้าวโพดใหม่อีกครั้ง'
    );
    err.isInvalidImage = true;
    throw err;
  }

  return normalizeCornResult(parsed, payload);
}

/**
 * Framework-agnostic request handler: takes a parsed payload, returns { status, body }.
 * Used by the Vercel function api/analyze.js (also run by the local server.js).
 */
export async function handleCornRequest(payload) {
  const traceId = `CORN-${Date.now()}`;
  const invalid = validateCornPayload(payload);
  if (invalid) return { status: 400, body: { error: invalid } };

  try {
    const result = await analyzeCorn(payload, traceId);
    result.traceId = traceId;
    console.log(`[${traceId}] SUCCESS | ${result.primaryIssue} | score ${result.healthScore}`);
    return { status: 200, body: result };
  } catch (err) {
    if (err.isInvalidImage) {
      console.warn(`[${traceId}] REJECTED image:`, err.message);
      return { status: 400, body: { success: false, isInvalidImage: true, error: err.message } };
    }
    console.error(`[${traceId}] FAILED:`, err);
    const msg = String(err?.message || err);
    if (isBusyError(err) || /หมดเวลา/.test(msg)) {
      return { status: 503, body: { error: BUSY_MESSAGE_TH } };
    }
    return { status: 500, body: { error: `เกิดข้อผิดพลาดในการวิเคราะห์: ${err?.message || err}` } };
  }
}
