# Cozy Companion Sprite Design Language & Guidelines (64x64)

Dokumen ini mendefinisikan prinsip desain visual tingkat tinggi (*high-level design language*) dan panduan gerak untuk companion Pokaico. Panduan ini dirancang agar cukup fleksibel untuk mengakomodasi berbagai jenis companion dengan anatomi fisik yang berbeda (seperti jamur, slime, kucing, atau robot), sambil tetap menjaga keselarasan estetika cozy-retro Pokaico.

---

## 1. Konsistensi Resolusi & Tampilan Retro
- **Satu Skala Resolusi**: Semua companion distandardisasi pada grid **64x64** pixel. Hal ini menjamin detail pixel art terasa konsisten di layar.
- **Rendering Tajam**: Render menggunakan setelan `image-rendering: pixelated` untuk mempertahankan visual retro yang bersih.
- **Gravitasi & Pivot**: Tentukan titik tumpu gravitasi di bagian bawah karakter (titik kontak dengan tanah) agar deformasi gerak terasa membumi secara alami.

---

## 2. Estetika Warna & Pencahayaan (Rosepine Harmony)
Warna companion harus selaras dengan palet Pokai yang teduh (*cozy lo-fi*):
- **Outline yang Lembut**: Hindari warna hitam pekat murni (`#000000`). Gunakan warna gelap yang hangat/ungu-abu-abu (seperti warna outline Rosepine `#26233a`) agar menyatu dengan UI.
- **Konsistensi Arah Cahaya**: Arahkan bayangan seolah-olah cahaya datang dari satu sudut (misalnya kiri atas) untuk memberikan volume 3D dithered retro.
- **Dithering untuk Dimensi**: Gunakan pola dithering catur untuk shading bayangan transisi, memberikan kesan tekstur retro tanpa memperumit palet warna.

---

## 3. Prinsip Gerak & Animasi (Cozy, Squishy, and Bouncy)
Setiap companion mengekspresikan emosi standar secara visual dengan prinsip gerak berikut:

- **Efek Bernapas & Melayang (Weight)**: Karakter harus memiliki gerakan naik-turun halus secara terus-menerus di state `idle` untuk menunjukkan kehidupan/napas tanpa terlihat terlalu sibuk.
- **Membal & Elastis (Squash & Stretch)**: Gerakan gembira (`happy` / `excited`) diekspresikan dengan memampat secara vertikal sebelum meregang tinggi saat melompat. Penyesuaian ini harus terasa elastis dan *cozy*, bukan kaku.
- **Goyangan Organik (Swaying)**: Saat mengekspresikan emosi berpikir atau berjalan, terapkan efek goyangan lateral (*tilt*) yang lebih lebar pada bagian atas karakter dibanding bagian bawahnya.
- **Partikel & Emote Melayang**: Gunakan partikel pixel art kecil atau balon gelembung emosi (seperti bintang, hati, atau tanda tanya) di atas kepala karakter untuk memperkuat ekspresi emosional LLM secara klasik.

---

## 4. Kustomisasi Fisiologi yang Fleksibel
Karena fisik companion berbeda-beda:
- Setiap companion mendefinisikan sendiri skema warna kustom (misal: warna topi untuk jamur vs warna bulu untuk kucing) dan opsi fisiknya (misal: tipe mata atau aksesoris) secara mandiri.
- Settings Panel akan membaca parameter kustomisasi ini secara dinamis untuk merender kontrol UI yang sesuai.
