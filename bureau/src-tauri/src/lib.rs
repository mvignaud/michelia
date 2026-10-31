// Michel sur l'ordinateur : la coquille native autour des écrans de Michel.
//
// Les écrans (le chat Expo exporté pour le web) sont embarqués dans l'appli : rien n'est chargé depuis
// michel.beer au démarrage. Par-dessus, ce que seul un vrai logiciel sait faire :
// - une icône dans la barre des menus (Mac) ou la zone de notification (Windows, Linux) ;
// - un raccourci clavier global (Ctrl+Maj+M, Cmd+Maj+M sur Mac) pour appeler Michel de n'importe où ;
// - fermer la fenêtre range Michel dans la barre au lieu de le quitter ;
// - une notification du système quand Michel répond et que la fenêtre n'est pas au premier plan ;
// - les liens michelia:// (retour de connexion Google / Facebook) reviennent dans l'appli ouverte ;
// - une seule appli ouverte à la fois, taille et position de la fenêtre gardées ;
// - tout lien vers l'extérieur s'ouvre dans le navigateur, jamais dans la fenêtre de Michel.

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_opener::OpenerExt;

const FENETRE: &str = "main";
const SITE: &str = "https://michel.beer";

fn fenetre(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(FENETRE)
}

fn montrer(app: &AppHandle) {
    if let Some(w) = fenetre(app) {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

// Le raccourci global : Michel apparaît, ou se range s'il est déjà devant.
fn basculer(app: &AppHandle) {
    if let Some(w) = fenetre(app) {
        if w.is_visible().unwrap_or(false) && w.is_focused().unwrap_or(false) {
            let _ = w.hide();
        } else {
            montrer(app);
        }
    }
}

// Seuls les liens du web (et les e-mails) partent vers le navigateur : jamais un fichier ni un programme.
fn lien_sur(url: &Url) -> bool {
    matches!(url.scheme(), "https" | "http" | "mailto")
}

// Les adresses qui restent dans la fenêtre : les écrans embarqués, et pendant le développement le serveur Expo.
fn adresse_interne(url: &Url) -> bool {
    match url.scheme() {
        "tauri" | "about" | "data" | "blob" => true,
        "http" | "https" => matches!(url.host_str(), Some("tauri.localhost") | Some("localhost") | Some("127.0.0.1")),
        _ => false,
    }
}

// Le captcha Turnstile tourne dans un cadre de michel.beer/captcha (le domaine déclaré chez Cloudflare).
fn cadre_captcha(url: &Url) -> bool {
    let s = url.as_str();
    s.starts_with("https://michel.beer/captcha") || s.starts_with("https://challenges.cloudflare.com/")
}

// Transmet un lien michelia:// aux écrans (retour de connexion), qui l'attendent sur l'événement « michel-lien ».
fn transmettre_lien(app: &AppHandle, url: &Url) {
    if url.scheme() != "michelia" {
        return;
    }
    montrer(app);
    if let (Some(w), Ok(json)) = (fenetre(app), serde_json::to_string(url.as_str())) {
        let _ = w.eval(format!("window.dispatchEvent(new CustomEvent('michel-lien', {{ detail: {json} }}))"));
    }
}

#[tauri::command]
fn ouvrir_dehors(app: AppHandle, url: String) -> Result<(), String> {
    let parsed = Url::parse(&url).map_err(|e| e.to_string())?;
    if !lien_sur(&parsed) {
        return Err("Lien refusé".into());
    }
    app.opener().open_url(parsed.as_str(), None::<&str>).map_err(|e| e.to_string())
}

// Michel a répondu : on prévient seulement si la fenêtre n'est pas devant les yeux.
#[tauri::command]
fn notifier(app: AppHandle, titre: String, texte: String) {
    let devant = fenetre(&app).map(|w| w.is_visible().unwrap_or(false) && w.is_focused().unwrap_or(false)).unwrap_or(false);
    if devant {
        return;
    }
    let texte: String = texte.chars().take(180).collect();
    let _ = app.notification().builder().title(titre).body(texte).show();
}

#[tauri::command]
fn version(app: AppHandle) -> String {
    app.package_info().version.to_string()
}

// Une nouvelle version est sortie : on demande, puis on ouvre la page de téléchargement.
#[tauri::command]
fn proposer_maj(app: AppHandle, version: String, page: String) {
    let Ok(page) = Url::parse(&page) else { return };
    if !page.as_str().starts_with("https://github.com/mvignaud/michelia/") && !page.as_str().starts_with(SITE) {
        return;
    }
    let ouvreur = app.clone();
    app.dialog()
        .message(format!("Michel {version} est sorti, avec des nouveautés. Tu le télécharges ?"))
        .title("Nouvelle version de Michel")
        .buttons(MessageDialogButtons::OkCancelCustom("Télécharger".into(), "Plus tard".into()))
        .show(move |oui| {
            if oui {
                let _ = ouvreur.opener().open_url(page.as_str(), None::<&str>);
            }
        });
}

fn barre(app: &AppHandle) -> tauri::Result<()> {
    let parler = MenuItem::with_id(app, "parler", "Parler à Michel", true, None::<&str>)?;
    let site = MenuItem::with_id(app, "site", "michel.beer", true, None::<&str>)?;
    let quitter = MenuItem::with_id(app, "quitter", "Quitter Michel", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&parler, &site, &PredefinedMenuItem::separator(app)?, &quitter])?;
    let mut icone = TrayIconBuilder::with_id("michel")
        .tooltip("MichelIA")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "parler" => montrer(app),
            "site" => {
                let _ = app.opener().open_url(SITE, None::<&str>);
            }
            "quitter" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                basculer(tray.app_handle());
            }
        });
    if let Some(image) = app.default_window_icon() {
        icone = icone.icon(image.clone());
    }
    icone.build(app)?;
    Ok(())
}

fn fenetre_principale(app: &AppHandle) -> tauri::Result<()> {
    let ouvreur = app.clone();
    WebviewWindowBuilder::new(app, FENETRE, WebviewUrl::App("index.html".into()))
        .title("MichelIA")
        .inner_size(480.0, 760.0)
        .min_inner_size(360.0, 520.0)
        .center()
        // Tout lien vers l'extérieur part dans le navigateur ; la fenêtre ne montre que Michel.
        .on_navigation(move |url| {
            if adresse_interne(url) || cadre_captcha(url) {
                return true;
            }
            if lien_sur(url) {
                let _ = ouvreur.opener().open_url(url.as_str(), None::<&str>);
            }
            false
        })
        .on_page_load(|w, payload| {
            if payload.event() == PageLoadEvent::Finished {
                let _ = w.show();
            }
        })
        .build()?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        // Une seule appli : relancer Michel ramène la fenêtre ouverte (et lui passe le lien michelia://).
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| montrer(app)));
        builder = builder.plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        basculer(app);
                    }
                })
                .build(),
        );
    }

    builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .invoke_handler(tauri::generate_handler![ouvrir_dehors, notifier, version, proposer_maj])
        .setup(|app| {
            let handle = app.handle().clone();
            fenetre_principale(&handle)?;
            barre(&handle)?;

            #[cfg(desktop)]
            {
                use tauri_plugin_global_shortcut::GlobalShortcutExt;
                // Si le raccourci est déjà pris par un autre logiciel, Michel s'en passe.
                let _ = app.global_shortcut().register("CommandOrControl+Shift+M");
            }

            use tauri_plugin_deep_link::DeepLinkExt;
            // Sous Linux et Windows (hors installeur), on déclare michelia:// au lancement.
            #[cfg(any(target_os = "linux", all(debug_assertions, windows)))]
            let _ = app.deep_link().register_all();
            let liens = handle.clone();
            app.deep_link().on_open_url(move |event| {
                for url in event.urls() {
                    transmettre_lien(&liens, &url);
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            // Fermer la fenêtre range Michel dans la barre ; « Quitter Michel » le quitte pour de bon.
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == FENETRE {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("Michel n'a pas pu démarrer")
        .run(|app, event| {
            // Mac : un clic sur l'icône du Dock ramène la fenêtre rangée.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event {
                montrer(app);
            }
            let _ = (app, event);
        });
}
