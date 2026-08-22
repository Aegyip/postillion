/**
 * Bağlam ölçeri.
 *
 * Kural `crates/proto/src/entities.rs` içinde (`context_window_for`,
 * `DEFAULT_CONTEXT_WINDOW`, `LONG_CONTEXT_WINDOW`) ve biçimlendirme
 * `crates/ui/src/context_meter.rs` içinde. Buradaki ikinci uygulama
 * BİLİNÇLİ: değerler panelin doğrudan Postgres'ten okuduğu kayıt
 * satırlarından geliyor, sunucunun HTTP ucundan değil, dolayısıyla Rust
 * tarafına sorulacak bir yer yok.
 *
 * Kural küçük ve nadiren değişiyor ama yine de bir anlaşma; `tests/…/
 * context_window.spec.ts` sayıları ve kuralı sabitliyor ve kaynağı
 * gösteriyor.
 */

/** Uzun bağlam seçilmemişken modellerin penceresi. */
export const DEFAULT_CONTEXT_WINDOW = 200_000
/** `[1m]` varyantının penceresi. */
export const LONG_CONTEXT_WINDOW = 1_000_000

/**
 * Sohbetin bağlam penceresi.
 *
 * Uzun bağlam İKİ yerde görünüyor: model kimliğinin `[1m]` eki (sürece giden
 * hâl) ve `contextWindow` model seçeneği (arayüzün yazdığı hâl). İkisi ayrı
 * anlarda güncellenebildiği için ikisine de bakılıyor.
 */
export function contextWindow(
  model: string | null,
  modelOptions: Record<string, unknown> | null
): number {
  const bySuffix = model?.includes('[1m]') ?? false
  const byOption = modelOptions?.contextWindow === '1m'
  return bySuffix || byOption ? LONG_CONTEXT_WINDOW : DEFAULT_CONTEXT_WINDOW
}

/** `142000` → `"142k"`. Bin altı ham: "0k" hiçbir şey söylemezdi. */
export function formatContext(tokens: number): string {
  if (tokens < 1000) {
    return String(tokens)
  }
  return `${Math.max(1, Math.ceil(tokens / 1000))}k`
}

/**
 * Doluluk yüzdesi.
 *
 * Sayının kendisi tek başına bir şey söylemiyor: 232k, 200k'lık bir modelde
 * duvarın ötesi, 1M'likte dörtte biri bile değil.
 *
 * Sıfırın üstündeki her ölçüm en az %1 yazıyor: %0 "ölçüm yok" gibi okunur,
 * oysa bir şey ölçülmüş durumda.
 */
export function contextPercent(tokens: number, window: number): number {
  if (window <= 0) {
    return 0
  }
  const percent = Math.round(Math.min(1, tokens / window) * 100)
  return tokens > 0 && percent === 0 ? 1 : percent
}

/** Ölçerin rengi — uygulamadaki üç seviyenin aynısı. */
export function contextLevel(percent: number): 'calm' | 'warn' | 'high' {
  if (percent >= 85) {
    return 'high'
  }
  return percent >= 60 ? 'warn' : 'calm'
}
