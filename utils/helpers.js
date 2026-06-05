'use strict';

/**
 * Tự nhận đơn vị vận chuyển dựa theo định dạng mã tracking.
 * Trả về tên hãng hoặc '' nếu không đoán được.
 */
function detectCarrier(tracking) {
  const t = String(tracking || '').trim().toUpperCase().replace(/\s/g, '');
  if (!t) return '';
  if (/^1Z[0-9A-Z]{16}$/.test(t)) return 'UPS';                 // UPS: 1Z...
  if (/^TBA\d+/.test(t)) return 'Amazon';                       // Amazon Logistics: TBA...
  if (/^(94|93|92|95|91|94)\d{18,24}$/.test(t)) return 'USPS';  // USPS: 9x... (20-26 số)
  if (/^\d{12}$/.test(t) || /^\d{15}$/.test(t)) return 'FedEx'; // FedEx: 12 hoặc 15 số
  if (/^\d{10}$/.test(t)) return 'DHL';                         // DHL: 10 số
  return '';
}

/**
 * Tạo link tra cứu vận đơn. Nếu chưa khai báo hãng, tự đoán từ mã tracking.
 * Trả về null nếu không có mã tracking.
 */
function buildTrackingUrl(carrier, tracking) {
  if (!tracking) return null;
  const t = encodeURIComponent(String(tracking).trim());
  let c = String(carrier || '').toLowerCase();
  if (!c.trim()) c = detectCarrier(tracking).toLowerCase(); // tự đoán nếu trống

  if (c.includes('usps')) return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${t}`;
  if (c.includes('ups')) return `https://www.ups.com/track?tracknum=${t}`;
  if (c.includes('fedex')) return `https://www.fedex.com/fedextrack/?trknbr=${t}`;
  if (c.includes('amazon')) return `https://track.amazon.com/tracking/${t}`;
  if (c.includes('dhl')) return `https://www.dhl.com/vn-vi/home/tracking.html?tracking-id=${t}`;
  if (c.includes('ghn')) return `https://donhang.ghn.vn/?order_code=${t}`;
  if (c.includes('ghtk') || c.includes('giao hang tiet kiem')) return `https://i.ghtk.vn/${t}`;
  if (c.includes('viettel')) return `https://viettelpost.com.vn/dinh-vi-buu-pham/?key=${t}`;
  if (c.includes('vnpost') || c.includes('vietnam post')) return `https://www.vnpost.vn/tra-cuu-hanh-trinh?key=${t}`;
  if (c.includes('j&t') || c.includes('jt')) return `https://jtexpress.vn/track?billcode=${t}`;
  // Mặc định: dùng 17track tra được hầu hết hãng quốc tế
  return `https://t.17track.net/en#nums=${t}`;
}

/**
 * Bóc mã SKU/ASIN từ link sản phẩm (chủ yếu Amazon).
 * Ví dụ: https://www.amazon.com/dp/B0EB4ADQW9 -> B0EB4ADQW9
 * Trả về '' nếu không tìm thấy.
 */
function extractSku(url) {
  if (!url) return '';
  const u = String(url);

  // Amazon: /dp/XXXX, /gp/product/XXXX, /product/XXXX, /ASIN/XXXX, ?asin=XXXX
  const amazon = u.match(/(?:\/dp\/|\/gp\/product\/|\/product\/|\/ASIN\/|[?&]asin=)([A-Z0-9]{10})/i);
  if (amazon) return amazon[1].toUpperCase();

  // ASIN dạng B0XXXXXXXX nằm bất kỳ đâu trong link
  const b0 = u.match(/\b(B0[A-Z0-9]{8})\b/i);
  if (b0) return b0[1].toUpperCase();

  return '';
}

module.exports = { buildTrackingUrl, detectCarrier, extractSku };
