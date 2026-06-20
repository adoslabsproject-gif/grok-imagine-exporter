document.getElementById("openGallery").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("gallery.html") });
});
