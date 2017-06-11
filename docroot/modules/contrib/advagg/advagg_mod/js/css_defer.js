/**
 * @file
 * Used to call loadCSS so css doesn't block the browser.
 */

var urlMatcher = new RegExp('href="(.*?)".*(advagg-css-defer)');
[].forEach.call(document.querySelectorAll('noscript'), function (el) {
  if (urlMatcher.test(el.innerHTML)) {
    loadCSS(urlMatcher.exec(el.innerHTML)[1]);
  }
});
