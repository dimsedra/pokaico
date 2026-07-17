# Cozy Companion Sprite Design Language & Guidelines (64x64)

Dokumen ini mendefinisikan prinsip desain visual tingkat tinggi (*high-level design language*) dan tolok ukur kualitas (*quality benchmark*) untuk companion Pokaico. Panduan ini dirancang agar cukup fleksibel untuk mengakomodasi berbagai jenis companion dengan anatomi fisik yang berbeda (seperti jamur, slime, kucing, atau robot), sambil tetap menjaga keselarasan estetika cozy-retro Pokaico.

---

## 1. Konsistensi Resolusi & Tampilan Retro
- **Satu Skala Resolusi**: Semua companion distandardisasi pada grid **64x64** pixel. Hal ini menjamin detail pixel art terasa konsisten di layar.
- **Rendering Tajam**: Render menggunakan setelan `image-rendering: pixelated` untuk mempertahankan visual retro yang bersih.
- **Gravitasi & Pivot**: Tentukan titik tumpu gravitasi di bagian bawah karakter (titik kontak dengan tanah) agar deformasi gerak terasa membumi secara alami.

---

## 2. Estetika Warna & Pencahayaan (Rosepine Harmony)
Warna companion harus selaras dengan palet Pokai yang teduh (*cozy lo-fi*):
- **Outline yang Lembut**: Hindari warna hitam pekat murni (`#000000`). Gunakan warna gelap yang hangat/kemerahan (seperti warna outline Rosepine `#26233a`) agar menyatu dengan UI.
- **Konsistensi Arah Cahaya**: Arahkan bayangan seolah-olah cahaya datang dari satu sudut (misalnya kiri atas) untuk memberikan volume 3D dithered retro.
- **Dithering untuk Dimensi**: Gunakan pola dithering catur untuk shading bayangan transisi, memberikan kesan tekstur retro tanpa memperumit palet warna.

---

## 3. Kualitas Animasi & Detail Aset (Shroomy Quality Benchmark)
Setiap companion baru wajib menyamai tingkat detail dan kehalusan animasi yang ditunjukkan oleh Shroomy:

- **Smoothness of Animation (Kelancaran Gerak)**:
  Animasi tidak boleh patah-patah (frame-by-frame kaku). Transisi antar gerakan dan deformasi visual harus berjalan sangat mulus dan interaktif pada **60 FPS** menggunakan kalkulasi waktu/trigonometri yang halus.
- **Fidelity & Detail (Kerapian Pixel)**:
  Tingkat kerapian susunan pixel, shading volumetrik, highlight cahaya, dither, dan partikel emosi pendukung harus setara dengan detail Shroomy yang sudah ada. Karakter harus terlihat hidup dan berbobot di dalam terrarium.

---

## 4. Kustomisasi Fisiologi yang Fleksibel
Karena fisik companion berbeda-beda:
- Setiap companion mendefinisikan sendiri skema warna kustom (misal: warna topi untuk jamur vs warna bulu untuk kucing) dan opsi fisiknya (misal: tipe mata atau aksesoris) secara mandiri.
- Settings Panel akan membaca parameter kustomisasi ini secara dinamis untuk merender kontrol UI yang sesuai.

