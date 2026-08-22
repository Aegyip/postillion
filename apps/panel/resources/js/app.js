/**
 * Canlı transkript.
 *
 * Sayfa açıkken sohbeti düzenli yokluyor. WebSocket daha zarif olurdu ama
 * panelin sunucuyla arasında zaten bir vekil var (tarayıcı sunucu jetonunu
 * ASLA görmemeli) ve yoklama o vekilden geçiyor.
 *
 * Yoklama ucuz: panel elindeki baş sırayı gönderiyor, değişmemişse sunucu
 * belgeyi hiç kurmuyor ve `unchanged` dönüyor.
 *
 * Gelen şey JSON değil HTML. Burada bir çizici tutmak, aynı veriyi iki
 * yerde çizmek demekti ve ikisi sessizce ayrı düşerdi — bu depoda tam
 * olarak o hata iki kez üretime çıktı. Sayfa da yoklama da
 * `partials/transcript`'i kullanıyor.
 */

const root = document.querySelector('[data-chat-id]')

if (root) {
  const chatId = root.dataset.chatId
  let headSeq = Number(root.dataset.headSeq || 0)
  /** Art arda hata sayısı — geri çekilme buna göre. */
  let failures = 0

  // Dar ekranda `.scroll` kaydırmıyor — sayfanın kendisi kaydırıyor. Hangisi
  // ise ona yazmak gerekiyor, yoksa telefonda çağrı sessizce hiçbir şey
  // yapmıyor ve sohbet kenar çubuğunun altında, en baştan açılıyor.
  const scroller = () =>
    root.scrollHeight > root.clientHeight + 1 ? root : document.scrollingElement

  const toBottom = () => {
    const el = scroller()
    el.scrollTop = el.scrollHeight
  }
  toBottom()
  // Yazı tipi `font-display: swap` ile geliyor: geldiğinde satırlar yeniden
  // akıyor ve transkript uzuyor. Bir kez kaydırmak yetmiyordu — uzun bir
  // sohbet en sonda değil, ortasında açılıyordu.
  document.fonts?.ready.then(toBottom)
  window.addEventListener('load', toBottom, { once: true })

  const render = (html) => {
    const list = root.querySelector('.transcript')
    if (!list) {
      // Transkript hiç çizilmemişti (boş sohbet); ilk mesajla birlikte
      // düzen de değişiyor, sayfayı yenilemek en basiti.
      window.location.reload()
      return
    }
    // Kullanıcı yukarı kaydırıp geçmişi okuyorsa yerinden ETMİYORUZ; yalnızca
    // zaten dipteyken takip ediyoruz.
    const el = scroller()
    const wasAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    list.outerHTML = html
    if (wasAtBottom) {
      toBottom()
    }
  }

  const poll = async () => {
    try {
      const response = await fetch(
        `/app/chats/${encodeURIComponent(chatId)}/messages?since=${headSeq}`,
        { headers: { accept: 'application/json' } }
      )
      if (!response.ok) {
        throw new Error(String(response.status))
      }
      const body = await response.json()
      failures = 0
      headSeq = body.headSeq ?? headSeq
      if (body.html) {
        render(body.html)
      }
    } catch {
      // Sessizce geri çekiliyoruz: geçici bir arıza için ekrana hata basmak,
      // okunabilir duran bir transkripti gürültüye boğardı.
      failures += 1
    }
    // Üst üste hatada aralık açılıyor, 30 saniyede duruyor.
    const delay = Math.min(3000 * 2 ** Math.min(failures, 4), 30_000)
    window.setTimeout(poll, delay)
  }

  window.setTimeout(poll, 3000)
}
