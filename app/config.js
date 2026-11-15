// ============================================================
// config.js — ตั้งค่าที่เดียว
// ============================================================
// ปล่อยว่าง ''  = โหมดทดลอง (ข้อมูลเก็บในเครื่อง ใช้ทดสอบหน้าจอได้ทันที)
// ใส่ URL       = ใช้งานจริงกับ Google Sheet ผ่าน Apps Script (backend/Code.gs)
//   วิธีหา URL: Apps Script → Deploy → Manage deployments → Web app URL (ลงท้าย /exec)
window.GAS_URL = '';

// แจ้งเตือนผ่าน LINE / Telegram — ยังเป็น mock (ตั้งค่าจริงที่ backend/Code.gs → NOTIFY_CONFIG)
window.NOTIFY_ENABLED = false;

window.GAS_URL = 'https://script.google.com/macros/s/AKfycbzO799US0thkKBp2UeWLu6AZ0rsLuSH-3SNrBj3C6tpFPoNMO-eVh9Q1KjuoKm965nI/exec';
