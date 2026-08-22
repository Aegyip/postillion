import { randomUUID } from 'node:crypto'
import env from '#start/env'
import { decode, encode } from '#services/device_frame'

/**
 * Cihaz rölesi üzerinden tek bir RPC çağrısı.
 *
 * Panel eşitleme protokolünü konuşmuyor; yalnızca bu röleye `role=client`
 * olarak bağlanıp motorun zaten sunduğu RPC'yi çağırıyor. `QueueCommand`
 * `targetDeviceId` ile uzak cihaza yönlendirilebilir olduğu için
 * (`crates/engine/src/rpc.rs`, `forwardable`) mesaj yazmanın yolu bu.
 *
 * Bağlantı çağrı BAŞINA açılıyor ve kapanıyor. Kalıcı bir bağlantı daha
 * verimli olurdu ama panelde gönderim seyrek ve açık tutulan bir soket,
 * sürecin ömrü boyunca yönetilmesi gereken bir durum demek.
 */

const RPC_KIND = 'rpc'
/** Bağlantı + cevap için üst sınır. */
const TIMEOUT_MS = 15_000

export class RelayError extends Error {}

/**
 * Röle adresi.
 *
 * `actAs` başlık DEĞİL sorgu parametresi: panelin sunduğu jeton
 * işletmecinin ve kimliği `SHARED_USER`, cihaz odası ise kullanıcıya ait —
 * kim adına bağlandığımızı söylemeden sahiplik denetimi 403 veriyor. Başlık
 * kullanılamıyor çünkü Node'un yerleşik `WebSocket`'i el sıkışmaya başlık
 * koymaya izin vermiyor; jetonun da burada olmasının sebebi aynı. Sunucu
 * bunu yalnızca paylaşılan jetonla kabul ediyor (`crates/server/src/auth.rs`).
 */
function wsUrl(deviceId: string, connId: string, userId: number) {
  const base = env.get('POSTILLION_SERVER_URL', '').replace(/^http/, 'ws').replace(/\/+$/, '')
  const token = env.get('POSTILLION_SERVER_TOKEN', '')
  return (
    `${base}/device/${encodeURIComponent(deviceId)}/ws` +
    `?role=client&connId=${connId}&token=${encodeURIComponent(token)}&actAs=${userId}`
  )
}

/**
 * `method`'u hedef cihazda çalıştırır ve `ok` gövdesini döndürür.
 *
 * Röle kontrol çerçeveleri (`" relay"` — baştaki boşluk KASITLI, sunucuyla
 * bayt bayt eşleşmek zorunda) hata olarak yükseltiliyor: `host_offline`
 * cihazın kapalı olduğunu söylüyor ve bunu zaman aşımı olarak beklemek
 * kullanıcıyı 15 saniye boşuna bekletirdi.
 */
export async function call(
  deviceId: string,
  userId: number,
  method: string,
  params: unknown
): Promise<unknown> {
  const connId = randomUUID()
  const socket = new WebSocket(wsUrl(deviceId, connId, userId))
  socket.binaryType = 'arraybuffer'

  try {
    return await new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new RelayError('Cihaz zamanında cevap vermedi')),
        TIMEOUT_MS
      )
      const finish = (fn: () => void) => {
        clearTimeout(timer)
        fn()
        socket.close()
      }

      socket.onerror = () => finish(() => reject(new RelayError('Röleye bağlanılamadı')))
      socket.onclose = () => finish(() => reject(new RelayError('Bağlantı cevap gelmeden kapandı')))

      socket.onopen = () => {
        const body = JSON.stringify({ id: 1, method, params })
        socket.send(encode({ s: RPC_KIND, k: RPC_KIND }, new TextEncoder().encode(body)))
      }

      socket.onmessage = (event) => {
        let header
        let payload
        try {
          ;({ header, payload } = decode(new Uint8Array(event.data as ArrayBuffer)))
        } catch (error) {
          return finish(() => reject(new RelayError(`Çerçeve çözülemedi: ${error}`)))
        }

        if (header.k === ' relay') {
          const code = (JSON.parse(new TextDecoder().decode(payload)) as { error?: string }).error
          return finish(() =>
            reject(
              new RelayError(
                code === 'host_offline' || code === 'host_closed'
                  ? 'Cihaz çevrimdışı'
                  : `Röle hatası: ${code}`
              )
            )
          )
        }

        const frame = JSON.parse(new TextDecoder().decode(payload)) as {
          id: number
          ok?: unknown
          err?: string
        }
        if (frame.err) {
          return finish(() => reject(new RelayError(frame.err!)))
        }
        finish(() => resolve(frame.ok))
      }
    })
  } finally {
    // `close()` iki kez çağrılabilir; zaten kapalıysa bu bir no-op.
    socket.close()
  }
}

/**
 * Bir koşumun ajan ayarları.
 *
 * Değerler sohbetin `config` satırından OLDUĞU GİBİ geçiyor. Panel kendi
 * varsayılanını yazsaydı, webden gönderilen mesaj uygulamada seçilenden
 * başka bir modelle koşardı — ve `sandbox` için tam olarak bu oluyordu.
 */
export interface RunConfig {
  harness: string | null
  model: string | null
  reasoning: string | null
  sandbox: string | null
}

/**
 * `QueueCommand`'ın `command` alanı.
 *
 * Motor burada bir komut KAYDI değil, kaydın YÜKÜNÜ bekliyor
 * (`QueueCommandParams.command: SessionCommandPayload`,
 * `crates/engine/src/rpc.rs`). Panel kaydın tamamını sarmalayıp gönderiyordu
 * ve motor "bad params: missing field `kind`" ile reddediyordu — webden
 * hiçbir mesaj gitmiyordu.
 *
 * Saf fonksiyon: şeklini `tests/fixtures/queue_command.json` sabitliyor ve
 * o dosyayı Rust tarafında gerçek tipe çözen bir test var
 * (`crates/doc/tests/panel_command_shape.rs`). Elle kurulan bir Rust yapısı
 * ancak böyle dürüst kalıyor.
 */
export function queueCommandParams(
  chatId: string,
  prompt: string,
  cwd: string,
  config: RunConfig,
  messageId: string
) {
  return {
    chatId,
    command: {
      kind: 'run',
      request: {
        prompt,
        cwd,
        // `sandbox` kebab-case: `workspace-write`. Panel `workspaceWrite`
        // yazıyordu ve motor onu bilinmeyen bir varyant olarak reddediyordu.
        // Sohbetin kendi seviyesi geçirilerek hem yazım hem de seçim doğru
        // oluyor — panel burada bir politika belirlememeli.
        sandbox: config.sandbox ?? 'workspace-write',
        // Alanlar yalnızca DEĞER VARSA yazılıyor: `null` göndermek ile hiç
        // göndermemek motor tarafında aynı şey değil.
        ...(config.harness ? { harness: config.harness } : {}),
        ...(config.model ? { model: config.model } : {}),
        ...(config.reasoning ? { reasoning: config.reasoning } : {}),
      },
      messageId,
    },
  }
}

/** Sohbete bir mesaj yazar. */
export async function sendPrompt(
  deviceId: string,
  userId: number,
  chatId: string,
  prompt: string,
  cwd: string,
  config: RunConfig
) {
  const params = queueCommandParams(chatId, prompt, cwd, config, randomUUID())
  return call(deviceId, userId, 'QueueCommand', params)
}

/** Harness'ın sunduğu modeller. */
export interface Model {
  id: string
  label: string
  description?: string
  reasoningLevels?: string[]
}

/**
 * Cihazdaki harness'ın model listesi.
 *
 * Liste CİHAZDAN geliyor, panelde sabit bir tablo yok: hangi modellerin
 * kullanılabilir olduğu oradaki kuruluma ve hesaba bağlı. Cihaz kapalıysa
 * sorulacak kimse yok ve seçim de yapılamaz — zaten yazma da yapılamıyor.
 */
export async function listModels(
  deviceId: string,
  userId: number,
  harness: string
): Promise<Model[]> {
  const reply = await call(deviceId, userId, 'ListModels', { harness })
  return Array.isArray(reply) ? (reply as Model[]) : []
}

/**
 * Sohbetin modelini/akıl yürütme seviyesini değiştirir.
 *
 * `SetChatConfig` TAM yapılandırmayı değiştiriyor, alan alan değil. Bu yüzden
 * sohbetin mevcut `config`'i olduğu gibi taşınıp yalnızca değişen alan
 * üzerine yazılıyor — yalnızca modeli göndermek `mcpServers` ve
 * `modelOptions` gibi alanları sessizce silerdi.
 *
 * Değişiklik kayıt belgesine yazılıyor ve LWW ile eşitleniyor: masaüstü
 * uygulaması da aynı seçimi görüyor.
 */
export function setChatConfigParams(
  chatId: string,
  currentConfig: Record<string, unknown>,
  model: string,
  reasoning: string | null
) {
  const config: Record<string, unknown> = { ...currentConfig, model }
  if (reasoning) {
    config.reasoning = reasoning
  } else {
    // Alanı SİLMEK gerekiyor, `null` yazmak değil: modelin desteklemediği
    // bir seviyeyi bırakmak, yanlış seviyeyle koşmak olurdu.
    delete config.reasoning
  }
  return { op: 'setChatConfig', chatId, config }
}

export async function setChatModel(
  deviceId: string,
  userId: number,
  chatId: string,
  currentConfig: Record<string, unknown>,
  model: string,
  reasoning: string | null
) {
  return call(
    deviceId,
    userId,
    'Mutate',
    setChatConfigParams(chatId, currentConfig, model, reasoning)
  )
}
