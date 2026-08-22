//! Transkriptin GÖRÜNÜM biçimi.
//!
//! Panel ham `MessagePart`'ı çizemiyor: bir araç çağrısının nasıl
//! adlandırıldığı (`Run`, `Read`, `Todo`, `Agent`…) uygulamada
//! `postillion_proto::view::tool_chip_content` içinde ve o Rust. Panel
//! TypeScript olduğu için ya aynı eşlemeyi ikinci kez yazacaktı ya da
//! sunucu hazır verecekti.
//!
//! İkincisi seçildi. Bu projede iki kez, bir anlaşmanın iki yarısı ayrı
//! düştüğü için üretimde hata çıktı (captcha alan adı, canlılık yoklaması);
//! araç etiketleri de tam olarak öyle bir anlaşma. Burada uygulamanın
//! çağırdığı fonksiyonun AYNISI çağrılıyor, dolayısıyla sapma imkânsız.
//!
//! Ham alanlar da korunuyor: görünüm biçimi ek, kayıp değil.

use postillion_doc::parts::{MessagePart, SubagentStatus};
use postillion_doc::SessionMessageEntry;
use postillion_proto::view::tool_chip_content;
use postillion_proto::ToolCall;
use serde_json::{json, Value};

/// Bir mesaj listesini panelin çizebileceği biçime çevirir.
pub fn render(entries: &[SessionMessageEntry]) -> Vec<Value> {
    entries.iter().map(render_entry).collect()
}

fn render_entry(entry: &SessionMessageEntry) -> Value {
    json!({
        "id": entry.id,
        "role": entry.role,
        "createdAt": entry.created_at,
        "deviceId": entry.device_id,
        "status": entry.status,
        "parts": entry.parts.iter().map(render_part).collect::<Vec<_>>(),
    })
}

fn render_part(part: &MessagePart) -> Value {
    match part {
        MessagePart::Text { id, text } => json!({ "kind": "text", "id": id, "text": text }),

        MessagePart::Error { id, message } => {
            json!({ "kind": "error", "id": id, "message": message })
        }

        // Soru parçası: uygulamada seçenekleriyle birlikte görünüyor, panelde
        // hiç görünmüyordu — kullanıcı ajanın kendisine bir şey sorduğunu
        // fark edemiyordu.
        MessagePart::Input {
            id,
            questions,
            resolved,
            ..
        } => json!({
            "kind": "input",
            "id": id,
            "resolved": resolved,
            "questions": questions,
        }),

        MessagePart::Tool {
            id,
            call,
            is_error,
            resolved,
            output,
            diff_stats,
            subagent_status,
            subagent_tail,
            ..
        } => {
            let (label, detail) = tool_chip_content(call);
            json!({
                "kind": "tool",
                "id": id,
                "label": label,
                "detail": detail,
                "isError": is_error,
                "resolved": resolved,
                "output": output,
                "diffStats": diff_stats,
                // Görev listesi ayrı taşınıyor: çipin ayrıntısı yalnızca
                // "2/5 done" diyor ve hangi işler olduğunu söylemiyor.
                "todo": todo_items(call),
                "subagent": subagent(subagent_status.as_ref(), subagent_tail.as_deref()),
            })
        }
    }
}

fn todo_items(call: &ToolCall) -> Option<Value> {
    match call {
        ToolCall::Todo { items } => Some(json!(items)),
        _ => None,
    }
}

fn subagent(status: Option<&SubagentStatus>, tail: Option<&str>) -> Option<Value> {
    let status = status?;
    Some(json!({ "status": status, "tail": tail }))
}
