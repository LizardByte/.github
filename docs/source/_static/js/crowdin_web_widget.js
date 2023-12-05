// this script requires jquery to be loaded on the source page, like so...
// <script src="https://ajax.googleapis.com/ajax/libs/jquery/3.5.1/jquery.min.js"></script>

// use Jquery to load other javascript
$.getScript('https://crowdin.com/js/crowdjet/crowdjet.js', function() {
    // crowdin web widget: https://crowdin.com/project/lizardbyte/tools/web-widget
    // get body
    let body = document.getElementsByTagName('body')[0]

    // create container (popup)
    let container = document.createElement('div')
    container.id = 'crowdjet-container'
    container.dataset.projectId = '614257'
    container.style.bottom = '90px'
    container.style.left = '5px'
    body.appendChild(container)

    // get sidebar
    let sidebar = document.getElementsByClassName('sidebar-sticky')[0]

    // create expand container (button)
    let expandContainer = document.createElement('div')
    expandContainer.id = 'crowdjet-expand-container'
    expandContainer.style.position = 'relative'
    expandContainer.style.bottom = '-25px'
    expandContainer.style.left = '160px'

    // hide expand container temporarily
    expandContainer.style.display = 'none'

    sleep(2000).then(() => {
        expandContainer.style.position = 'relative'
    })

    sidebar.appendChild(expandContainer)

    sleep(2000).then(() => {
        // get html of crowdjet-expand-iframe
        let iframe = document.getElementById('crowdjet-expand-iframe');
        let iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
        let htmlTag = iframeDoc.getElementsByTagName('html')[0];

        // get html of crowdjet-iframe
        let iframe2 = document.getElementById('crowdjet-iframe');
        let iframeDoc2 = iframe2.contentDocument || iframe2.contentWindow.document;
        let htmlTag2 = iframeDoc2.getElementsByTagName('html')[0];

        updateIframeStyles(htmlTag);
        updateIframe2Styles(htmlTag2);

        // show expand container
        expandContainer.style.display = 'block'

        // Set up mutation observer to watch for changes in the data-theme attribute
        const observer = new MutationObserver((mutationsList, observer) => {
            for(let mutation of mutationsList) {
                if (mutation.attributeName === 'data-theme') {
                    updateIframeStyles(htmlTag);
                    updateIframe2Styles(htmlTag2);
                }
            }
        });

        observer.observe(document.body, { attributes: true, attributeFilter: ['data-theme'] });
    })

    function updateIframeStyles(htmlTag) {
        let element = document.querySelector('.sidebar-sticky');
        let colorValue;

        if (element) {
            colorValue = getComputedStyle(element).getPropertyValue('--color-sidebar-background').trim();
        }

        htmlTag.style.backgroundColor = colorValue;
    }

    function updateIframe2Styles(htmlTag) {
        let element = document.querySelector('.content');
        let colorValue;

        if (element) {
            colorValue = getComputedStyle(element).getPropertyValue('--color-background-primary').trim();
        }

        htmlTag.style.backgroundColor = colorValue;
    }
})
