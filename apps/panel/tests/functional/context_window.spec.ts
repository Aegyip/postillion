import { test } from '@japa/runner'
import {
  DEFAULT_CONTEXT_WINDOW,
  LONG_CONTEXT_WINDOW,
  contextLevel,
  contextPercent,
  contextWindow,
  formatContext,
} from '#services/context_window'

/**
 * Bu kuralın kaynağı Rust'ta: `crates/proto/src/entities.rs`
 * (`context_window_for`) ve `crates/ui/src/context_meter.rs`. Panel değerleri
 * doğrudan veritabanından okuduğu için ikinci bir uygulama taşıyor; bu testler
 * onu sabitliyor, böylece Rust tarafı değiştiğinde burada da düşer.
 */
test.group('Bağlam penceresi', () => {
  test('varsayılan 200k', ({ assert }) => {
    assert.equal(DEFAULT_CONTEXT_WINDOW, 200_000)
    assert.equal(contextWindow(null, null), 200_000)
    assert.equal(contextWindow('claude-opus-5', {}), 200_000)
  })

  test('[1m] eki uzun pencere veriyor', ({ assert }) => {
    assert.equal(LONG_CONTEXT_WINDOW, 1_000_000)
    assert.equal(contextWindow('claude-sonnet-5[1m]', null), 1_000_000)
  })

  test('model seçeneği de uzun pencere veriyor', ({ assert }) => {
    // İki yol ayrı anlarda güncelleniyor; birine bakmak yetmiyor.
    assert.equal(contextWindow('claude-sonnet-5', { contextWindow: '1m' }), 1_000_000)
  })

  test('bin altı ham yazılıyor', ({ assert }) => {
    assert.equal(formatContext(0), '0')
    assert.equal(formatContext(999), '999')
    assert.equal(formatContext(1000), '1k')
    assert.equal(formatContext(141_501), '142k')
  })

  test('sıfırın üstü asla %0 göstermiyor', ({ assert }) => {
    // %0 "ölçüm yok" gibi okunur.
    assert.equal(contextPercent(0, 200_000), 0)
    assert.equal(contextPercent(50, 200_000), 1)
    assert.equal(contextPercent(100_000, 200_000), 50)
  })

  test('pencereyi aşan ölçüm %100 ile duruyor', ({ assert }) => {
    assert.equal(contextPercent(400_000, 200_000), 100)
  })

  test('aynı sayı pencereye göre farklı seviyede', ({ assert }) => {
    // 300k: 1M'lik modelde sakin, 200k'lıkta çoktan kritik.
    assert.equal(contextLevel(contextPercent(300_000, LONG_CONTEXT_WINDOW)), 'calm')
    assert.equal(contextLevel(contextPercent(300_000, DEFAULT_CONTEXT_WINDOW)), 'high')
  })
})
