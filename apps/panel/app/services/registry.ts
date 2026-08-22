import db from '@adonisjs/lucid/services/db'

/**
 * Kayıt satırlarını okur — cihaz ve sohbet listesi.
 *
 * Bu satırlar sunucunun `registry_rows` tablosunda düz JSON olarak duruyor,
 * yani liste için CRDT çalıştırmaya gerek yok. Sohbetin İÇERİĞİ farklı: o opak
 * loro güncellemesi ve sunucu materyalize ediyor (`GET /chat2/{id}/messages`).
 *
 * Liste bilgisayar KAPALIYKEN de görünüyor — satırlar sunucuda, cihazda değil.
 */

interface Row {
  id: string
  fields: Record<string, unknown>
}

export interface Device {
  id: string
  name: string
  platform: string
  /** Açılış/kapanış damgası — canlılık ÖLÇÜSÜ DEĞİL, bkz. `online`. */
  lastSeenAt: number | null
  online: boolean
}

export interface Chat {
  id: string
  title: string
  deviceId: string | null
  cwd: string | null
  branch: string | null
  lastMessageAt: number | null
  /** `cwd · branch` — şablonda birleştirmek yerine burada, tek yerde. */
  location: string
  /** Sohbeti tutan cihaz şu an açık mı — yazma bu şarta bağlı. */
  deviceOnline: boolean
}

/** Kullanıcının sahiplendiği kayıt odaları. */
async function orgsOf(userId: number): Promise<string[]> {
  const rows = await db
    .from('room_owners')
    .select('room')
    .where('scope', 'registry')
    .andWhere('user_id', userId)
  return rows.map((r: { room: string }) => r.room)
}

async function rowsOf(userId: number, kind: string): Promise<Row[]> {
  const orgs = await orgsOf(userId)
  if (orgs.length === 0) {
    return []
  }
  // Sorgu kullanıcının odalarıyla SINIRLI. Sunucu da aynı denetimi yapıyor
  // ama panel veritabanına doğrudan gidiyor ve onu atlıyor — izolasyon
  // burada AYRICA kurulmak zorunda.
  const rows = await db
    .from('registry_rows')
    .select('id', 'fields')
    .whereIn('org', orgs)
    .andWhere('kind', kind)
    .andWhere('deleted', false)
  return rows as Row[]
}

function str(fields: Record<string, unknown>, key: string): string | null {
  const value = fields[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

function ms(fields: Record<string, unknown>, key: string): number | null {
  const value = fields[key]
  return typeof value === 'number' ? value : null
}

/**
 * Çevrimiçi cihazlar.
 *
 * Kayıt satırlarındaki `lastSeenAt` bu soruyu CEVAPLAMIYOR: o yalnızca açılış
 * ve kapanışta yazılıyor, dolayısıyla açık duran bir cihaz orada saatler
 * öncesinde görünüyor. Canlı atışlar sunucunun belleğinde ve oradan
 * okunuyor.
 */
async function onlineIds(userId: number, fetchPresence: PresenceFetcher): Promise<Liveness> {
  const orgs = await orgsOf(userId)
  const ids = new Set<string>()
  // Odası olmayan kullanıcı için soracak bir şey yok; bunu "bilinmiyor"
  // saymak boş listeyi gereksizce şüpheli gösterirdi.
  let known = true
  for (const org of orgs) {
    const live = await fetchPresence(org)
    if (live === null) {
      // TEK bir odanın cevapsız kalması bile yeter: eksik bir listeyle
      // "çevrimdışı" demek, açık bir cihazı kapalı göstermek olur.
      known = false
      continue
    }
    for (const id of live) {
      ids.add(id)
    }
  }
  return { known, ids }
}

/** Canlılık okunabildi mi, ve okunabildiyse kimler açık. */
interface Liveness {
  known: boolean
  ids: Set<string>
}

/** Bir odadaki canlı cihaz kimlikleri; sunucuya ulaşılamazsa `null`. */
export type PresenceFetcher = (org: string) => Promise<string[] | null>

export interface Workspace<T> {
  items: T[]
  /** Canlılık okunabildi mi — okunamadıysa arayüz "bilinmiyor" göstermeli. */
  livenessKnown: boolean
}

function toDevices(rows: Row[], online: Set<string>): Device[] {
  return (
    rows
      .map((row) => ({
        id: row.id,
        // Adsız cihaz listede boş bir satır olarak görünmemeli.
        name: str(row.fields, 'name') ?? row.id,
        platform: str(row.fields, 'platform') ?? 'unknown',
        lastSeenAt: ms(row.fields, 'lastSeenAt'),
        online: online.has(row.id),
      }))
      // Çevrimiçi olanlar üstte: panelin işi onlarla.
      .sort(
        (a, b) => Number(b.online) - Number(a.online) || (b.lastSeenAt ?? 0) - (a.lastSeenAt ?? 0)
      )
  )
}

function toChats(rows: Row[], online: Set<string>): Chat[] {
  return rows
    .filter((row) => row.fields.archived !== true)
    .map((row) => {
      const deviceId = str(row.fields, 'deviceId')
      const cwd = str(row.fields, 'cwd')
      const branch = str(row.fields, 'branch')
      return {
        id: row.id,
        title: str(row.fields, 'title') ?? 'Untitled',
        deviceId,
        cwd,
        branch,
        location: [cwd, branch].filter(Boolean).join(' · '),
        lastMessageAt: ms(row.fields, 'lastMessageAt'),
        deviceOnline: deviceId !== null && online.has(deviceId),
      }
    })
    .sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0))
}

export async function devices(
  userId: number,
  presence: PresenceFetcher
): Promise<Workspace<Device>> {
  const [rows, online] = await Promise.all([rowsOf(userId, 'devices'), onlineIds(userId, presence)])
  return { items: toDevices(rows, online.ids), livenessKnown: online.known }
}

export async function chats(userId: number, presence: PresenceFetcher): Promise<Workspace<Chat>> {
  const [rows, online] = await Promise.all([rowsOf(userId, 'chats'), onlineIds(userId, presence)])
  return { items: toChats(rows, online.ids), livenessKnown: online.known }
}

/**
 * Kenar çubuğunun ihtiyacı olan her şey, TEK canlılık okumasıyla.
 *
 * Kabuk her `/app` sayfasında duruyor, yani üç denetleyici de aynı ikiliyi
 * istiyor. `devices()` ve `chats()` ayrı ayrı çağrılsaydı presence iki kez
 * sorulurdu; ikisi farklı cevap verdiğinde kenar çubuğundaki nokta ile ana
 * içerikteki durum birbirini tutmazdı.
 */
export async function sidebar(userId: number, presence: PresenceFetcher) {
  const [deviceRows, chatRows, online] = await Promise.all([
    rowsOf(userId, 'devices'),
    rowsOf(userId, 'chats'),
    onlineIds(userId, presence),
  ])
  return {
    devices: toDevices(deviceRows, online.ids),
    chats: toChats(chatRows, online.ids),
    livenessKnown: online.known,
  }
}
