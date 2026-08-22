import { test } from '@japa/runner'
import { readFile } from 'node:fs/promises'
import app from '@adonisjs/core/services/app'
import { queueCommandParams, setChatConfigParams } from '#services/device_rpc'

const FIXTURE = 'tests/fixtures/queue_command.json'

/**
 * `QueueCommand` yükünün şekli.
 *
 * Bu yük Rust'ta tanımlı (`SessionCommandPayload`, `RunRequest`) ama panel
 * onu elle kuruyor — TypeScript'ten o tiplere erişilmiyor. İki hata birden
 * bu yüzden üretime çıktı ve webden hiçbir mesaj gitmedi:
 *
 * - `command` alanına komut KAYDI konuyordu, motor ise kaydın YÜKÜNÜ
 *   bekliyor → "bad params: missing field `kind`"
 * - `sandbox` değeri `workspaceWrite` yazılıyordu, doğrusu `workspace-write`
 *
 * Buradaki test çıktının sabit dosyayla aynı olmasını istiyor; o dosyayı
 * `crates/doc/tests/panel_command_shape.rs` gerçek Rust tipine çözüyor.
 * İkisi birlikte, elle kurulan yükü iki uçtan bağlıyor.
 */
test.group('QueueCommand yükü', () => {
  const built = queueCommandParams(
    'chat-1',
    'sürümü yayınla',
    '/home/u/proje',
    {
      harness: 'claude-code',
      model: 'claude-opus-5',
      reasoning: 'high',
      sandbox: 'workspace-write',
    },
    'msg-1'
  )

  test('sabit dosyayla aynı', async ({ assert }) => {
    const fixture = JSON.parse(await readFile(app.makePath(FIXTURE), 'utf8'))
    assert.deepEqual(
      built,
      fixture,
      `yük değişmiş. Rust tarafı da bu dosyayı okuyor; güncellerken\n` +
        `crates/doc/tests/panel_command_shape.rs testini de koşun.`
    )
  })

  test('kayıt değil YÜK gönderiliyor', ({ assert }) => {
    // Motor `command`'da doğrudan `kind` arıyor; kaydın içine gömmek
    // "missing field `kind`" veriyordu.
    assert.equal(built.command.kind, 'run')
    assert.notProperty(built.command, 'payload')
  })

  test('ayarlar sohbetten geçiyor, panel varsayılan yazmıyor', ({ assert }) => {
    assert.equal(built.command.request.model, 'claude-opus-5')
    assert.equal(built.command.request.sandbox, 'workspace-write')
  })

  test('boş ayar hiç yazılmıyor', ({ assert }) => {
    // `null` göndermek ile alanı hiç göndermemek motor tarafında aynı değil.
    const bare = queueCommandParams(
      'c',
      'p',
      '/tmp',
      {
        harness: null,
        model: null,
        reasoning: null,
        sandbox: null,
      },
      'm'
    )
    assert.notProperty(bare.command.request, 'model')
    assert.notProperty(bare.command.request, 'harness')
    assert.equal(bare.command.request.sandbox, 'workspace-write')
  })
})

/**
 * `Mutate {op: setChatConfig}` yükü.
 *
 * Bu da elle kurulan bir Rust yapısı. `SetChatConfig` TAM değişim yapıyor:
 * eksik gönderilen her alan siliniyor, dolayısıyla mevcut yapılandırmanın
 * olduğu gibi taşınması bir tercih değil, şart.
 *
 * Sabit dosyayı `crates/engine/src/rpc.rs` içindeki bir test gerçek
 * `MutateParams` tipine çözüyor.
 */
test.group('SetChatConfig yükü', () => {
  const current = {
    harness: 'claude-code',
    model: 'claude-opus-5',
    reasoning: 'low',
    modelOptions: {},
    sandbox: 'workspace-write',
    mcpServers: ['github'],
  }

  test('sabit dosyayla aynı', async ({ assert }) => {
    const fixture = JSON.parse(
      await readFile(app.makePath('tests/fixtures/set_chat_config.json'), 'utf8')
    )
    assert.deepEqual(setChatConfigParams('chat-1', current, 'claude-sonnet-5', 'high'), fixture)
  })

  test('tanımadığımız alanlar korunuyor', ({ assert }) => {
    // Yalnızca modeli göndermek `mcpServers`'ı silerdi.
    const out = setChatConfigParams('c', current, 'm', null)
    assert.deepEqual(out.config.mcpServers, ['github'])
  })

  test('seviye verilmezse alan siliniyor', ({ assert }) => {
    // `null` yazmak ile alanı kaldırmak aynı değil; modelin seviyesi yoksa
    // eskisini bırakmak yanlış seviyeyle koşmak olurdu.
    const out = setChatConfigParams('c', current, 'm', null)
    assert.notProperty(out.config, 'reasoning')
  })
})
