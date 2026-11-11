/*! HotelAI chat widget — embed with:
 *  <script src="https://YOUR-APP/widget.js" data-key="wk_..." async></script>
 *  Optional: data-color="#1f57d6" data-position="left"
 */
(function () {
  "use strict";
  var script = document.currentScript;
  if (!script || window.__hotelaiWidget) return;
  window.__hotelaiWidget = true;
  var key = script.getAttribute("data-key") || "";
  if (!/^wk_[0-9a-f]{32}$/.test(key)) { console.warn("[HotelAI] invalid data-key"); return; }
  var origin = new URL(script.src).origin;
  var color = /^#[0-9a-fA-F]{6}$/.test(script.getAttribute("data-color") || "") ? script.getAttribute("data-color") : "#1f57d6";
  var side = script.getAttribute("data-position") === "left" ? "left" : "right";

  var button = document.createElement("button");
  button.type = "button";
  button.setAttribute("aria-label", "Open chat");
  button.style.cssText = "position:fixed;bottom:20px;" + side + ":20px;width:56px;height:56px;border-radius:50%;border:0;cursor:pointer;z-index:2147483646;box-shadow:0 6px 20px rgba(0,0,0,.2);color:#fff;font-size:24px;background:" + color;
  button.textContent = "\u{1F4AC}";

  var frame = null;
  function toggle() {
    if (!frame) {
      frame = document.createElement("iframe");
      frame.src = origin + "/widget/" + key;
      frame.title = "Chat with us";
      frame.style.cssText = "position:fixed;bottom:88px;" + side + ":20px;width:min(380px,calc(100vw - 40px));height:min(560px,calc(100vh - 120px));border:0;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.25);z-index:2147483647;background:#fff";
      frame.setAttribute("allow", "clipboard-write");
      document.body.appendChild(frame);
      button.setAttribute("aria-label", "Close chat");
      return;
    }
    var hidden = frame.style.display === "none";
    frame.style.display = hidden ? "block" : "none";
    button.setAttribute("aria-label", hidden ? "Close chat" : "Open chat");
  }
  button.addEventListener("click", toggle);
  (document.body ? Promise.resolve() : new Promise(function (r) { document.addEventListener("DOMContentLoaded", r); })).then(function () {
    document.body.appendChild(button);
  });
})();
