# คู่มือสร้าง VM ฟรีตลอดชีพ (Google Compute Engine e2-micro Always Free)

คู่มือนี้จะพาทำทีละขั้นตอนในการสร้างเครื่อง Server (VM) บน **Google Cloud** แบบ **ฟรี 100% ตลอดชีพ (Always Free)** ไม่เสียค่าบริการรายเดือน เพื่อรันระบบ **REMEMBER Multi-User Twitch Overlay** ตลอด 24 ชม.

---

## 📋 เงื่อนไขโควตา Always Free ของ Google Cloud
เพื่อให้ใช้งานได้ฟรี 100% ไม่ถูกคิดเงิน ต้องตั้งค่าเครื่องตามนี้อย่างเคร่งครัด:
- **Region**: ต้องเลือก `us-central1` (Iowa), `us-east1` (South Carolina), หรือ `us-west1` (Oregon)
- **Machine Type**: `e2-micro` (2 vCPU, 1 GB memory)
- **Boot Disk**: ชนิด **Standard persistent disk** ขนาดไม่เกิน **30 GB**

---

## 🚀 ขั้นตอนที่ 1: สร้าง VM ใน Google Cloud Console (ผ่านเว็บ)

1. เข้าไปที่ [Google Cloud Console - VM Instances](https://console.cloud.google.com/compute/instances)
2. ถ้ายังไม่ได้เปิด Compute Engine API ให้กดคลิก **Enable**
3. คลิกปุ่ม **"CREATE INSTANCE"** (สร้างอินสแตนซ์) ที่ด้านบน
4. ตั้งค่าตามหัวข้อด้านล่างนี้:

| หัวข้อ | ค่าที่ต้องเลือก / กรอก | หมายเหตุ |
| :--- | :--- | :--- |
| **Name** | `remember-overlay-vm` | ตั้งชื่ออะไรก็ได้ตัวพิมพ์เล็ก |
| **Region** | `us-central1` (Iowa) | *สำคัญมาก: ต้องเป็น us-central1, us-east1 หรือ us-west1 เท่านั้น* |
| **Zone** | เลือก zone ใดก็ได้ เช่น `us-central1-a` | |
| **Machine configuration** | Series: **E2**<br>Machine type: **e2-micro** | จะมีข้อความสีเขียวขึ้นว่า *Free tier eligible* |

5. **ตั้งค่า Boot disk** (สำคัญมาก):
   - ให้คลิกปุ่ม **"CHANGE"** ใต้หัวข้อ Boot disk
   - **Operating system**: เลือก **Ubuntu**
   - **Version**: เลือก **Ubuntu 24.04 LTS x86/64**
   - **Boot disk type**: เปลี่ยนเป็น **Standard persistent disk** *(ห้ามเลือก Balanced หรือ SSD เพราะจะเสียเงิน)*
   - **Size (GB)**: ใส่ **30** (โควตาฟรีให้สูงสุด 30 GB)
   - กดปุ่ม **"SELECT"**

6. **ตั้งค่า Firewall** (เปิดให้คนเข้าเว็บได้):
   - เลื่อนลงมาที่หัวข้อ **Firewall**
   - ✅ ติ๊กถูกที่ **Allow HTTP traffic**
   - ✅ ติ๊กถูกที่ **Allow HTTPS traffic**

7. กดปุ่ม **"CREATE"** ด้านล่างสุด แล้วรอประมาณ 30-60 วินาที

---

## 💻 ขั้นตอนที่ 2: รันระบบบน VM ผ่าน Web SSH

1. เมื่อสร้างเสร็จ ในหน้า [VM instances](https://console.cloud.google.com/compute/instances) คุณจะเห็นชื่อเครื่อง `remember-overlay-vm`
2. ให้คลิกปุ่ม **"SSH"** ที่อยู่ด้านขวาสุดของแถวเครื่องนั้น
3. จะมีหน้าต่าง Terminal สีดำเปิดขึ้นมาในเบราว์เซอร์
4. พิมพ์หรือวางคำสั่งต่อไปนี้ (กดปุ่ม Enter):

```bash
git clone https://github.com/<your-username>/REMEMBER-Redeem-Overlay.git
cd REMEMBER-Redeem-Overlay
bash setup-gce.sh
```
*(เปลี่ยน `<your-username>` เป็นชื่อ GitHub ของคุณ หรือหากยังไม่ได้เอาขึ้น GitHub สามารถใช้ git หรืออัปโหลดไฟล์ได้)*

5. ตัวสคริปต์จะทำงานแบบอัตโนมัติทั้งหมด:
   - ตั้งค่า Swap memory ป้องกัน RAM เต็ม
   - ติดตั้ง Node.js 24 และ Caddy Web Server
   - ขอให้คุณใส่ `TWITCH_CLIENT_ID` และ `TWITCH_CLIENT_SECRET` (หากยังไม่มีไฟล์ `.env`)
   - ออกใบรับรองความปลอดภัย **HTTPS (SSL Certificate ฟรีจาก Let's Encrypt)** ให้อัตโนมัติทันที
   - ตั้งค่าให้ระบบทำงานตลอด 24 ชั่วโมงใน Background (systemd auto-restart)

---

## 🔑 ขั้นตอนที่ 3: อัปเดต Twitch Developer Console

เมื่อสคริปต์รันเสร็จ จะแสดงลิงก์ URL ประจำเครื่องของคุณ เช่น:
```text
https://34-123-45-67.sslip.io
```

1. ไปที่ [Twitch Developer Console](https://dev.twitch.tv/console/apps)
2. กด **Manage** ที่ Application ของคุณ
3. ในช่อง **OAuth Redirect URLs** เพิ่ม URL นี้ลงไป:
   ```text
   https://34-123-45-67.sslip.io/auth/twitch/callback
   ```
4. กด **Save Changes**

---

## 🌟 ตรวจสอบและใช้งาน

1. เปิดเบราว์เซอร์ไปที่: `https://<ip>.sslip.io`
2. คุณจะเห็นหน้าเว็บ **REMEMBER Overlay** พร้อมสัญลักษณ์แม่กุญแจเขียว (HTTPS) ปลอดภัย 100%
3. กดปุ่ม **Sign in with Twitch** เพื่อเริ่มใช้งานและคัดลอก Browser Source URL ไปใส่ใน OBS Studio ได้ทันที!

