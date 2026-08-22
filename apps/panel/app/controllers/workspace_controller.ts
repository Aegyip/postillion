import type { HttpContext } from '@adonisjs/core/http'
import { sidebar } from '#services/registry'
import { presence } from '#services/sync_server'

/**
 * Panelin ana ekranı: cihazlar ve sohbetler.
 *
 * Liste veritabanından, canlılık sunucudan geliyor. Sunucuya ulaşılamazsa
 * liste yine gösteriliyor — geçmişi görmek için cihazın açık olması
 * gerekmiyor ve bunu bir bağlantı arızası yüzünden gizlemek yanlış olurdu.
 */
export default class WorkspaceController {
  async index({ view, auth }: HttpContext) {
    const user = auth.getUserOrFail()
    // Kenar çubuğu ile ana içerik AYNI okumadan besleniyor; iki ayrı çağrı
    // presence'ı iki kez sorar ve ikisi farklı cevap verirse ekranın iki
    // yarısı birbirini tutmaz.
    const shell = await sidebar(user.id, (org) => presence(org, user.id))

    return view.render('pages/workspace', { ...shell, activeChatId: null })
  }
}
