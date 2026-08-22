//! Panelin gönderdiği `QueueCommand` yükü gerçekten çözülüyor mu.
//!
//! Yük burada tanımlı ([`SessionCommandPayload`], `RunRequest`) ama panel
//! TypeScript ve onu ELLE kuruyor — bu tiplere erişimi yok. İki hata birden
//! o yüzden üretime çıktı ve webden hiçbir mesaj gitmedi:
//!
//! - `command` alanına komut KAYDI konuyordu, motor ise kaydın YÜKÜNÜ
//!   bekliyor (`QueueCommandParams`, crates/engine/src/rpc.rs) →
//!   "bad params: missing field `kind`"
//! - `sandbox` `workspaceWrite` yazılıyordu; doğrusu `workspace-write`
//!
//! Panelin kendi testi ürettiği yükün bu dosyayla aynı olmasını istiyor
//! (`apps/panel/tests/functional/queue_command.spec.ts`); burası aynı
//! dosyanın gerçek tipe çözüldüğünü. İkisi birlikte, elle kurulan yükü iki
//! uçtan bağlıyor: hangisi kayarsa biri düşüyor.

use std::path::PathBuf;

use postillion_doc::commands::SessionCommandPayload;

fn fixture() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|p| p.parent())
        .expect("depo kökü")
        .join("apps/panel/tests/fixtures/queue_command.json")
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct QueueCommand {
    #[allow(dead_code)]
    chat_id: String,
    command: SessionCommandPayload,
}

#[test]
fn panelin_yuku_motorun_tipine_cozuluyor() {
    let path = fixture();
    let raw = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("{} okunamadı: {e}", path.display()));

    let parsed: QueueCommand = serde_json::from_str(&raw).unwrap_or_else(|e| {
        panic!(
            "\npanelin gönderdiği yük çözülemiyor: {e}\n\
             dosya: {}\n\
             Bu tam olarak webden mesaj göndermeyi kıran arıza; şekli\n\
             `SessionCommandPayload` ile hizalayın.\n",
            path.display()
        )
    });

    // Yalnızca çözülmesi yetmez: yanlış varyanta düşen bir yük de çözülür.
    let SessionCommandPayload::Run { request, .. } = parsed.command else {
        panic!("panelin gönderdiği komut `run` olmalı");
    };
    assert_eq!(request.prompt, "sürümü yayınla");
    // Ayarlar sohbetten geçiyor; panel kendi varsayılanını yazmamalı.
    assert_eq!(request.model.as_deref(), Some("claude-opus-5"));
    assert_eq!(
        request.sandbox,
        postillion_proto::SandboxLevel::WorkspaceWrite
    );
}
