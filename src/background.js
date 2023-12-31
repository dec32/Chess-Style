import browser from "./browser.js"
import storage from "./storage.js"

const sites = [
    {
        url: "*://lichess.org/*",
        css: (color, piece, url) => `.is2d .${color}.${piece} {background-image: url(${url})!important}`  
    },
    {
        url: "*://www.chess.com/*",
        css: (color, piece, url) => {
            let id = `${color[0]}${piece=="knight"?'n':piece[0]}`
            return `.${id}{background-image: url(${url})!important}`
        }
    }
]
const sitesWithScript =  browser.runtime.getManifest().content_scripts.flatMap(it => it.matches)

// on start up
storage.forEachPieces(apply)

// listen for new tabs
browser.webNavigation.onCommitted.addListener(async detail => {
    storage.forEachPieces((color, piece, url)=>{
        apply(color, piece, url, detail.tabId)
    })
})

// listen for changes from popup
browser.runtime.onMessage.addListener(async (msg, sender, respond) => {
    if (msg.url) {
        await apply(msg.color, msg.piece, msg.url)
        storage.setPiece(msg.color, msg.piece, msg.url)
    } else {
        await revert(msg.color, msg.piece)
        storage.removePiece(msg.color, msg.piece)
    }
    // tabs with script won't detect changes from popup, so repost the messages to them
    let tabs = await browser.tabs.query({ url: sitesWithScript })
    for (let tab of tabs) {
        browser.tabs.sendMessage(tab.id, msg)
    }
    return true
})


async function apply(color, piece, url, tabId) {
    if (!tabId) {
        await revert(color, piece)
    }
    for (let site of sites) {
        let css = site.css(color, piece, url)
        let tabs = await browser.tabs.query({url:site.url})
        for (let tab of tabs) {
            if (tabId && tabId != tab.id) {
                continue;
            }
            let target = {tabId: tab.id}
            browser.scripting.insertCSS({ target: target, css: css })
            console.debug(`Tab #${tab.id}(${site.url}): Injected CSS for ${color} ${piece}."`)
            // store the css so that it can be reverted
            putInjected(site, color, piece, css)
        }
    }
}


async function revert(color, piece) {
    for (let site of sites) {
        let css = delInjected(site, color, piece)
        if (!css) {
            return
        }
        let tabs = await browser.tabs.query({url:site.url})
        for (let tab of tabs) {
            let target = { tabId: tab.id }
            await browser.scripting.removeCSS({ target: target, css: css })
            console.debug(`Tab #${tab.id}(${site.url}): Removed CSS for ${color} ${piece}.`)
        }
    }
}


function putInjected(site, color, piece, css) {
    if (!site.injected) {
        site.injected = new Map()
    }
    let key = `${color}_${piece}`
    site.injected[key] = css
}

function delInjected(site, color, piece) {
    if (!site.injected) {
        return null
    }
    let key = `${color}_${piece}`
    let css = site.injected[key]
    site.injected.delete(key)
    return css
}