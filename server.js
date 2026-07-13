const net = require('net');
const http = require('http');

// กำหนด Port (บน Render ฟรีจะใช้ env เพื่อจัดสรรพอร์ตให้)
const TCP_PORT = process.env.TCP_PORT || 5023; // พอร์ตสำหรับรับข้อมูล GPS
const HTTP_PORT = process.env.PORT || 3000;   // พอร์ตสำหรับรันเว็บเพจหลอกให้ Render ปล่อยผ่าน

// ==========================================
// 1. ส่วนของ TCP SERVER (รับและถอดรหัสข้อมูล GPS)
// ==========================================
const server = net.createServer((socket) => {
    console.log(`[+] Device connected from: ${socket.remoteAddress}:${socket.remotePort}`);

    let deviceIMEI = 'Unknown'; 

    socket.on('data', (data) => {
        // แสดงข้อมูลดิบในรูปแบบฐานสิบหก (Hexadecimal)
        console.log(`\n[Raw Data Hex]: ${data.toString('hex').toUpperCase()}`);

        // ตรวจสอบโครงสร้างขั้นต่ำของ Packet GT06 (ต้องขึ้นต้นด้วย 0x78 0x78)
        if (data.length < 5 || data[0] !== 0x78 || data[1] !== 0x78) {
            console.log('[-] Invalid packet format (Not GT06)');
            return;
        }

        const protocolNumber = data[3];
        console.log(`[Protocol ID]: 0x${protocolNumber.toString(16).toUpperCase()}`);

        // แยกแยะการทำงานตามประเภทของโปรโตคอลหลัก
        switch (protocolNumber) {
            case 0x01: // Login Message (ยืนยันตัวตนเครื่อง)
                console.log('>>> Handling Login Message...');
                
                // ดึง IMEI ออกมาจาก Byte ที่ 4 ถึง 11 (ความยาว 8 Byte ในรูปแบบ BCD)
                deviceIMEI = data.subarray(4, 12).toString('hex');
                console.log(`[Device IMEI]: ${deviceIMEI}`);

                // อ่าน Serial Number ของ Packet จากเครื่อง เพื่อนำไปตอบกลับ
                const loginSerial = data.readUInt16BE(data.length - 6);

                // ส่งคำตอบกลับ (Login ACK) เพื่อให้เครื่อง GPS รู้ว่า Server รับทราบแล้ว
                const loginResponse = Buffer.from([
                    0x78, 0x78,             // Start Bit
                    0x05,                   // Length
                    0x01,                   // Protocol ID
                    (loginSerial >> 8) & 0xFF, // Serial High Byte
                    loginSerial & 0xFF,        // Serial Low Byte
                    0x00, 0x00,             // CRC (Error Check)
                    0x0D, 0x0A              // Stop Bit
                ]);
                socket.write(loginResponse);
                console.log(`<<< Sent Login ACK`);
                break;
                
            case 0x22: // Location Data (ข้อมูลพิกัดดาวเทียม)
            case 0x12:
                console.log('>>> Handling Location Data...');
                try {
                    // แกะข้อมูลตามสเปกมาตรฐานของโปรโตคอล GT06
                    const latRaw = data.readUInt32BE(11); 
                    const lngRaw = data.readUInt32BE(15);
                    const speed = data[19]; // ความเร็วรถ (กิโลเมตร/ชั่วโมง)

                    // แปลงข้อมูลดิบให้เป็นทศนิยมละติจูด/ลองจิจูดจริง
                    const latitude = latRaw / 1800000;
                    const longitude = lngRaw / 1800000;

                    console.log(`📍 [Location Data] IMEI: ${deviceIMEI}`);
                    console.log(`   พิกัด Lat: ${latitude}, Lng: ${longitude}`);
                    console.log(`   ความเร็ว: ${speed} km/h`);
                    
                    // TODO: นำข้อมูลไปเก็บลง Database (เช่น MySQL/MongoDB) ในสเต็ปถัดไป
                } catch (e) {
                    console.log('[-] Error parsing location:', e.message);
                }
                break;

            case 0x13: // Heartbeat Message (การรักษาสัญญาณเชื่อมต่อ)
                console.log('>>> Handling Heartbeat...');
                const hbSerial = data.readUInt16BE(data.length - 6);
                
                // ส่งคำตอบกลับ (Heartbeat ACK) เพื่อรักษา Session การเชื่อมต่อ
                const hbResponse = Buffer.from([
                    0x78, 0x78, 
                    0x05, 
                    0x13,
                    (hbSerial >> 8) & 0xFF, 
                    hbSerial & 0xFF,
                    0x00, 0x00, 
                    0x0D, 0x0A
                ]);
                socket.write(hbResponse);
                console.log(`<<< Sent Heartbeat ACK`);
                break;

            default:
                console.log(`[!] Unknown Protocol ID: 0x${protocolNumber.toString(16).toUpperCase()}`);
        }
    });

    socket.on('close', () => {
        console.log(`[-] Device disconnected: ${deviceIMEI}`);
    });

    socket.on('error', (err) => {
        console.error(`[X] Socket Error (${deviceIMEI}):`, err.message);
    });
});

// เริ่มเปิดทำงาน TCP Server
server.listen(TCP_PORT, () => {
    console.log(`==========================================`);
    console.log(`  GT06E TCP Server is running on port ${TCP_PORT}`);
    console.log(`==========================================`);
});


// ==========================================
// 2. ส่วนของ HTTP SERVER (สำหรับหลอกระบบของ Render)
// ==========================================
http.createServer((req, res) => {
    // เมื่อมีคนหรือระบบของ Render เข้ามาที่ URL เว็บ จะแสดงข้อความนี้เพื่อยืนยันว่ายังทำงานอยู่
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('ระบบรับสัญญาณ GPS (GT06E TCP Server) กำลังทำงานออนไลน์อยู่ตามปกติ 🚀\n');
}).listen(HTTP_PORT, () => {
    console.log(`[HTTP Ping] Standard HTTP Web Port opened on port ${HTTP_PORT}`);
});