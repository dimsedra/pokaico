# Cozy Companion Sprite Design Language & Guidelines (64x64)

Dokumen ini mendefinisikan bahasa desain visual, aturan pixel art, dan logika matematika animasi untuk companion prosedural Pokaico. Panduan ini wajib dijadikan acuan oleh developer maupun AI coding agent ketika merancang karakter companion baru (misalnya Slimey, Kitty, dll.) agar serasi dengan estetika cozy-retro Pokaico.

---

## 1. Aturan Grid & Resolusi Pixel
- **Logical Grid**: Seluruh companion digambar pada grid logis berukuran **64x64**.
- **Pixel Rendering**: Di-render ke layar menggunakan CSS `image-rendering: pixelated` agar tepian pixel tetap tajam (*crisp*), tidak blur.
- **Pivot Point**: Tentukan titik tumpu gravitasi karakter (pusat bawah tubuh, biasanya `Y=54`, `X=32`) agar deformasi membal (*squash & stretch*) berpusat secara alami di tanah.

---

## 2. Palet Warna & Pencahayaan (Cozy Retro Palette)
Bahasa desain Pokaico berbasis pada tema **Rosepine** yang hangat dan teduh:
- **Outline Ink (Garis Tepi)**: Selalu gunakan warna gelap yang lembut (misalnya `#0c0e15` atau `#26233a`) untuk membungkus karakter. Hindari hitam pekat murni `#000000`.
- **Arah Cahaya**: Cahaya datang dari **kiri atas (top-left)**. Oleh karena itu:
  * Sisi kiri/atas karakter mendapatkan warna dasar dan *highlight* terang.
  * Sisi kanan/bawah karakter mendapatkan warna *shadow* (bayangan).
- **Dithering Klasik (Retro Mid-Tones)**:
  * Gunakan pola catur `% 2 === 0` untuk menciptakan bayangan bergradasi halus (*dither shading*) tanpa menambah palet warna baru.
  * Contoh implementasi dither catur: `const dither = (rx + ry) % 2 === 0;`

---

## 3. Struktur Fisiologi & Kustomisasi
Setiap companion harus mendukung opsi kustomisasi warna dan gaya yang diekspor melalui skema metadata:
- **Color Customization**: Pisahkan warna dasar (*base*), warna bayangan (*shadow*), dan warna detail kustom (seperti warna mata, blush pipi, aksesoris).
- **Fisiologi Opsional**: Sediakan opsi gaya fisik (misalnya gaya mata: `bead`/`anime`/`minimal`, atau aksesoris tubuh) untuk menambah kedalaman interaksi kustom.

---

## 4. Logika Animasi & Fisika Deformasi (Dynamic Cozy Motion)
Animasi tidak dibuat frame-by-frame, melainkan menggunakan transformasi matematika dinamis berbasis waktu (`time`):

- **Breathing / Idle Floating**:
  Gunakan fungsi gelombang `Math.sin(time)` dengan frekuensi lambat untuk membuat sprite naik-turun secara halus, melambangkan nafas atau efek melayang yang cozy.
- **Squash & Stretch (Membal)**:
  Saat melompat atau bergerak gembira (`happy` / `excited`), sprite harus memampat (menggepeng) di tanah sebelum melompat tinggi dan memanjang secara vertikal:
  * Di tanah: `scaleY < 1.0`, `scaleX > 1.0` (squash).
  * Di udara: `scaleY > 1.0`, `scaleX < 1.0` (stretch).
- **Swaying / Tilting (Goyangan Organik)**:
  Goyangan tubuh ke kiri/kanan (`tilt`) harus dihitung berdasarkan ketinggian pixel (`ry` relatif terhadap pivot). Bagian atas kepala bergoyang lebih lebar dibanding bagian bawah yang menempel di tanah:
  * `tiltOffset = tilt * (Math.abs(ry) / height)`
- **Emotional Particles**:
  Gunakan partikel pixel kecil yang memancarkan energi emosi di sekitar sprite (seperti bintang naik untuk `excited`, tetesan air turun untuk `sad`, atau gelembung melayang untuk `sleeping`).
