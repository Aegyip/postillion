//! Panelin gördüğü transkript biçimi.
//!
//! Uygulamada görünen soru, komut ve görev satırları panelde hiç
//! görünmüyordu: uç ham `MessagePart` yayınlıyordu ve panel yalnızca
//! `call.command`/`call.path` okuyabiliyordu — yani `Todo`, `Search`,
//! `WebFetch`, `Agent` ve BÜTÜN soru parçaları sessizce boşa düşüyordu.

use postillion_doc::parts::{MessagePart, MessageStatus, SubagentStatus};
use postillion_doc::schema::{MessageRole, SessionMessageEntry};
use postillion_proto::{TodoItem, ToolCall, UserInputQuestion};
use postillion_server::transcript_view::render;

fn entry(parts: Vec<MessagePart>) -> SessionMessageEntry {
    SessionMessageEntry {
        id: "m1".into(),
        role: MessageRole::Assistant,
        parts,
        created_at: 1,
        device_id: "dev".into(),
        status: Some(MessageStatus::Complete),
        continuation_of: None,
    }
}

fn tool(call: ToolCall) -> MessagePart {
    MessagePart::Tool {
        id: "p1".into(),
        call,
        is_error: false,
        resolved: true,
        output: None,
        diff: None,
        output_ref: None,
        output_bytes: None,
        diff_ref: None,
        diff_stats: None,
        subagent_ref: None,
        subagent_status: None,
        subagent_tail: None,
    }
}

fn part0(entries: &[serde_json::Value]) -> &serde_json::Value {
    &entries[0]["parts"][0]
}

/// Etiket uygulamanın kendi fonksiyonundan geliyor; panel ikinci bir eşleme
/// tutmuyor.
#[test]
fn arac_cipleri_uygulamayla_ayni_adlandiriliyor() {
    let cases = [
        (
            ToolCall::Exec {
                command: "cargo test".into(),
            },
            "Run",
            "cargo test",
        ),
        (
            ToolCall::ReadFile {
                path: "src/lib.rs".into(),
            },
            "Read",
            "src/lib.rs",
        ),
        (
            ToolCall::Search {
                pattern: "todo".into(),
                path: Some("src".into()),
            },
            "Search",
            "todo in src",
        ),
        (
            ToolCall::WebSearch {
                query: "loro crdt".into(),
            },
            "Web",
            "loro crdt",
        ),
    ];

    for (call, label, detail) in cases {
        let rendered = render(&[entry(vec![tool(call)])]);
        let part = part0(&rendered);
        assert_eq!(part["label"], label);
        assert_eq!(part["detail"], detail);
    }
}

/// Görev listesi: çipin ayrıntısı yalnızca "1/2 done" diyor, hangi işler
/// olduğunu söylemiyor — kalemler ayrıca taşınıyor.
#[test]
fn gorev_listesi_kalemleriyle_geliyor() {
    let rendered = render(&[entry(vec![tool(ToolCall::Todo {
        items: vec![
            TodoItem {
                text: "şemayı yaz".into(),
                done: true,
            },
            TodoItem {
                text: "testleri koş".into(),
                done: false,
            },
        ],
    })])]);
    let part = part0(&rendered);

    assert_eq!(part["label"], "Todo");
    assert_eq!(part["detail"], "1/2 done");
    assert_eq!(part["todo"][0]["text"], "şemayı yaz");
    assert_eq!(part["todo"][0]["done"], true);
    assert_eq!(part["todo"][1]["done"], false);
}

/// Ajanın kullanıcıya sorduğu soru. Panelde HİÇ görünmüyordu: kullanıcı
/// kendisinden cevap beklendiğini fark edemiyordu.
#[test]
fn soru_parcasi_secenekleriyle_geliyor() {
    let rendered = render(&[entry(vec![MessagePart::Input {
        id: "q1".into(),
        request_id: "r1".into(),
        questions: vec![UserInputQuestion {
            id: "a".into(),
            header: "Sürüm".into(),
            question: "Hangi sürüm yayınlansın?".into(),
            options: vec!["yama".into(), "minör".into()],
            multi_select: false,
        }],
        resolved: false,
    }])]);
    let part = part0(&rendered);

    assert_eq!(part["kind"], "input");
    assert_eq!(part["resolved"], false);
    assert_eq!(part["questions"][0]["question"], "Hangi sürüm yayınlansın?");
    assert_eq!(part["questions"][0]["options"][1], "minör");
}

/// Alt ajan çipi: durumu ve son çıktısı olmadan satır "Agent" deyip susuyor.
#[test]
fn alt_ajan_durumu_ve_kuyrugu_geliyor() {
    let mut part = tool(ToolCall::Unknown {
        name: "Agent: depoyu tara".into(),
        input: None,
    });
    if let MessagePart::Tool {
        subagent_status,
        subagent_tail,
        ..
    } = &mut part
    {
        *subagent_status = Some(SubagentStatus::Running);
        *subagent_tail = Some("dosyalar okunuyor".into());
    }

    let rendered = render(&[entry(vec![part])]);
    let part = part0(&rendered);

    assert_eq!(part["label"], "Agent");
    assert_eq!(part["detail"], "depoyu tara");
    assert_eq!(part["subagent"]["status"], "running");
    assert_eq!(part["subagent"]["tail"], "dosyalar okunuyor");
}

/// Metin ve hata parçaları eskisi gibi; görünüm biçimi EK, kayıp değil.
#[test]
fn metin_ve_hata_parcalari_korunuyor() {
    let rendered = render(&[entry(vec![
        MessagePart::Text {
            id: "t1".into(),
            text: "merhaba".into(),
        },
        MessagePart::Error {
            id: "e1".into(),
            message: "düştü".into(),
        },
    ])]);

    assert_eq!(rendered[0]["role"], "assistant");
    assert_eq!(rendered[0]["status"], "complete");
    assert_eq!(rendered[0]["parts"][0]["text"], "merhaba");
    assert_eq!(rendered[0]["parts"][1]["message"], "düştü");
}
