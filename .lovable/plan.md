## Plan: Veritabanını TMDB ile Sıfırdan Doldurma

### 1. `seed-database` Edge Function Oluştur
- TMDB'den popüler Türk dizileri, filmleri ve belgeselleri çeker
- Her içerik için platform bilgisini (TMDB + JustWatch) alır
- Türkiye'de platformu bulunan içerikleri `contents` ve `content_platforms` tablolarına yazar
- Mevcut verileri temizler (truncate) ve yeniden doldurur

### 2. Kategoriler
- **Diziler**: TMDB discover/tv → origin_country=TR + popüler yabancı diziler (TR platformlarında olanlar)
- **Filmler**: TMDB discover/movie → region=TR + popüler filmler
- **Belgeseller**: TMDB discover → with_genres=99

### 3. Platform Eşleştirme
- TMDB watch/providers → TR bölgesi
- Platform tablosundaki mevcut kayıtlarla eşleştir (slug bazlı)
- Yeni platform varsa otomatik ekle

### 4. Admin Panelden Tetikleme
- AdminPanel'e "Veritabanını Yenile" butonu ekle
- Butona basınca seed-database fonksiyonu çağrılsın
