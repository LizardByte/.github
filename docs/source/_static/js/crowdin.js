// this script requires jquery to be loaded on the source page, like so...
// <script src="https://ajax.googleapis.com/ajax/libs/jquery/3.5.1/jquery.min.js"></script>

// use Jquery to load other javascript
$.getScript('https://proxy-translator.app.crowdin.net/assets/proxy-translator.js', function() {
    window.proxyTranslator.init({
        baseUrl: "https://docs.lizardbyte.dev",
        appUrl: "https://proxy-translator.app.crowdin.net",
        valuesParams: "U2FsdGVkX19eQczbrFgaLYbrEBP8is5CVpC2YSnXxH/sRjWqaBtQOsLZJbSRMepcn3D2sofzZxALb2pvT3MLmM+WG5EpWSF7CzzYsAOJ+k/FpMUJ1PZ1FQmmlKCIWyD7",
        distributionBaseUrl: "https://distributions.crowdin.net",
        filePath: "/docs.lizardbyte.dev.json",
        distribution: "fb3b3d5c18de9bc717d96b91bw4",
        languagesData: {
            "en":{"code":"en","name":"English","twoLettersCode":"en"},
            "it":{"code":"it","name":"Italian","twoLettersCode":"it"},
            "es-ES":{"code":"es-ES","name":"Spanish","twoLettersCode":"es"},
        },
        defaultLanguage: "en",
        defaultLanguageTitle: "English",
        languageDetectType: "default",
        poweredBy: false,
        position: "bottom-left",
        submenuPosition: "top-left",
    })

    // container
    let container = document.getElementById('crowdin-language-picker')
    container.classList.remove('cr-position-bottom-left')

    // change styling of language selector button
    let button = document.getElementsByClassName('cr-picker-button')[0]

    // container auto width based on content
    container.style.width = button.offsetWidth + 10 + 'px'
    container.style.position = 'relative'
    container.style.left = '10px'
    container.style.bottom = '10px'

    // get rst versions
    let sidebar = document.getElementsByClassName('sidebar-sticky')[0]

    // move button to related pages
    sidebar.appendChild(container)
})
