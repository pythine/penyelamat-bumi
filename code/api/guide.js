// Fungsi serverless Vercel untuk bot pemandu "Pandu".
// Pasang di folder /api (sejajar dengan index.html), lalu di Vercel > Settings > Environment Variables isi:
//   GROQ_API_KEY      = kunci API Groq-mu (WAJIB, dari console.groq.com; jangan taruh di index.html)
//   GUIDE_MODEL       = (opsional) default llama-3.3-70b-versatile; ganti jika model itu sudah dihentikan Groq
//   ALLOWED_ORIGIN    = (opsional) mis. https://namaapp.vercel.app, agar situs lain tidak bisa memakai kuncimu
// Setelah deploy ulang, Pandu otomatis memakai AI. Jika fungsi ini tidak ada, Pandu memakai jawaban bawaan.

const SYSTEM = `Kamu adalah Pandu, bot pemandu ramah untuk pengguna BARU aplikasi "Voice & Gift Room" (bahasa Indonesia, santai, jawaban singkat maksimal 4 kalimat, boleh pakai poin).
Fitur aplikasi yang BENAR:
- 5 menu bawah: Room, Postingan, Video, Teman, Profil.
- Room: ruang suara dengan kursi. Ketuk kursi kosong (＋) untuk duduk dan bicara lewat mikrofon; ketuk kursi sendiri untuk turun; ketuk kursi orang lain untuk lihat profil/kirim gift. Chat room bisa balas, tag (@nama), teruskan ke teman, rekam suara, ganti tema, dan kirim foto sekali lihat. Emoji gerak muncul di foto kursi saat duduk. Tiap room punya peti sendiri (mulai Lv.1) yang naik level lewat gift.
- Gift: memakai Koin Emas. Poin gift yang DITERIMA menaikkan level SVIP 1-13 (gelar punya masa berlaku dan bisa diperpanjang).
- Koin gratis: Check-in Harian (tab Profil), game koin (ikon gamepad di tab Postingan, maks 30 koin per game), peti room, atau pemberian Host.
- Postingan: buat postingan teks/foto dengan tombol +, ketuk postingan untuk memperbesar, like dan komentar. Story bulat hidup 24 jam (foto/video), bisa di-like dan dikomentari.
- Video: feed video pendek, geser ke atas.
- Teman: radar menampilkan semua yang online; buka profil untuk ajukan pertemanan atau ikuti; chat pribadi layar penuh; pesan yang sudah dibaca terhapus otomatis setelah 24 jam.
- Profil: foto, nama, level, Border Avatar (border terkunci dibuka oleh Host lewat chat WhatsApp; border gelar Mythic/Legend terbuka otomatis), Check-in Harian.
- Tema chat terkunci sampai Host membukanya.
- Ikon lonceng = notifikasi.
Aturan: jangan mengarang fitur yang tidak ada di daftar. Jika tidak tahu atau butuh tindakan Host, sarankan menghubungi Host. Jangan minta atau menerima data pribadi/sandi. Tolak topik di luar aplikasi dengan sopan.`;

const hits = new Map(); // pembatas sederhana per IP (best-effort per instance)

module.exports = async (req, res) => {
  const origin = process.env.ALLOWED_ORIGIN;
  if (origin && req.headers.origin && req.headers.origin !== origin) return res.status(403).json({ error: 'forbidden' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  const key = process.env.GROQ_API_KEY;
  if (!key) return res.status(500).json({ error: 'GROQ_API_KEY belum diisi' });

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'x';
  const now = Date.now(), arr = (hits.get(ip) || []).filter(t => now - t < 60000);
  if (arr.length >= 12) return res.status(429).json({ error: 'terlalu cepat' });
  arr.push(now); hits.set(ip, arr);
  if (hits.size > 5000) hits.clear();

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body) } catch { body = {} } }
  let msgs = Array.isArray(body?.messages) ? body.messages : [];
  msgs = msgs.slice(-8)
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .map(m => ({ role: m.role, content: m.content.slice(0, 500) }));
  while (msgs.length && msgs[0].role !== 'user') msgs.shift();
  if (!msgs.length) return res.status(400).json({ error: 'pesan kosong' });

  try {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
      body: JSON.stringify({
        model: process.env.GUIDE_MODEL || 'llama-3.3-70b-versatile',
        max_tokens: 400,
        temperature: 0.4,
        messages: [{ role: 'system', content: SYSTEM }, ...msgs]
      })
    });
    const j = await r.json();
    if (!r.ok) return res.status(502).json({ error: j?.error?.message || 'gagal' });
    const reply = String(j.choices?.[0]?.message?.content || '').trim();
    return res.status(200).json({ reply });
  } catch (e) {
    return res.status(502).json({ error: 'gagal menghubungi AI' });
  }
};
