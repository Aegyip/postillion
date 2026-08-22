import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'

/**
 * Transkript parçasının çizimi.
 *
 * İki ayrı hata sınıfını kapatıyor:
 *
 * 1. **Sessizce düşen parçalar.** Panel yalnızca metin, hata ve `command`
 *    taşıyan araçları çiziyordu; soru, görev listesi, diff ve alt ajan
 *    satırları hiç görünmüyordu. Sayfa yine 200 dönüyordu.
 * 2. **İşlenmemiş şablon.** Edge tag'leri kendi satırlarında olmak zorunda;
 *    satır içi bir `@if` çıktıya DÜZ METİN olarak düşüyor ve hiçbir yerde
 *    hata görünmüyor. Bu depoda aynı sınıf hata üç kez üretime çıktı.
 */
test.group('Transkript', () => {
  const messages = [
    {
      id: 'm1',
      role: 'assistant',
      createdAt: 1,
      parts: [
        {
          kind: 'tool',
          id: 'p1',
          label: 'Todo',
          detail: '1/2 done',
          resolved: true,
          isError: false,
          todo: [
            { text: 'testleri koş', done: true },
            { text: 'sürümü yükselt', done: false },
          ],
        },
        {
          kind: 'tool',
          id: 'p2',
          label: 'Edit',
          detail: 'src/http.rs',
          resolved: true,
          isError: false,
          diffStats: [{ path: 'src/http.rs', additions: 12, deletions: 3 }],
        },
        {
          kind: 'tool',
          id: 'p3',
          label: 'Agent',
          detail: 'depoyu tara',
          resolved: true,
          isError: false,
          subagent: { status: 'running', tail: 'CHANGELOG.md okunuyor' },
        },
        {
          kind: 'tool',
          id: 'p4',
          label: 'Run',
          detail: 'gh release create',
          resolved: true,
          isError: true,
          output: 'error: already exists',
        },
        {
          kind: 'input',
          id: 'q1',
          resolved: false,
          questions: [
            {
              id: 'a',
              header: 'Sürüm',
              question: 'Hangi sürüm olsun?',
              options: ['yama', 'minör'],
              multiSelect: false,
            },
          ],
        },
      ],
    },
  ]

  async function html() {
    const ctx = await testUtils.createHttpContext()
    return ctx.view.render('partials/transcript', { messages })
  }

  test('her parça türü çiziliyor', async ({ assert }) => {
    const body = await html()
    for (const needle of [
      'testleri koş',
      'sürümü yükselt',
      'src/http.rs',
      '+12',
      'depoyu tara',
      'CHANGELOG.md okunuyor',
      'error: already exists',
      'Hangi sürüm olsun?',
      'minör',
    ]) {
      assert.include(body, needle, `çizilmeyen parça: ${needle}`)
    }
  })

  test('cevap bekleyen soru işaretleniyor', async ({ assert }) => {
    // Kullanıcıdan bir şey bekleniyorsa bunun fark edilmesi gerekiyor;
    // soruyu sessizce çizmek onu araç gürültüsünün içinde kaybederdi.
    assert.include(await html(), 'awaiting an answer')
  })

  test('hatalı araç işaretleniyor', async ({ assert }) => {
    assert.include(await html(), 'is-error')
  })

  test('işlenmemiş şablon tag i çıktıya düşmüyor', async ({ assert }) => {
    const body = await html()
    for (const tag of ['@if', '@each', '@end', '@include']) {
      assert.notInclude(body, tag, `şablon işlenmemiş: ${tag}`)
    }
  })
})
