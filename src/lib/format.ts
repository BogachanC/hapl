const tryFormatter = new Intl.NumberFormat("tr-TR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatTRY(value: number | null): string {
  if (value === null) return "Fiyat bilinmiyor";
  if (value === 0) return "Ücretsiz";
  return `${tryFormatter.format(value)} ₺`;
}
