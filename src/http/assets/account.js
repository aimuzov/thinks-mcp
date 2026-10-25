// The account page's own script. The kit's CSP closes inline scripts
// and handlers, so everything the page does in the browser lives here.

const reload = document.querySelector('[data-reload]')

if (reload) setTimeout(() => location.reload(), Number(reload.getAttribute('data-reload')))

for (const form of document.querySelectorAll('form[data-confirm]')) {
	form.addEventListener('submit', (event) => {
		if (!confirm(form.getAttribute('data-confirm') ?? '')) event.preventDefault()
	})
}

const upload = document.getElementById('upload')
const input = document.getElementById('dump')
const progress = document.getElementById('progress')

upload?.addEventListener('click', () => {
	const file = input instanceof HTMLInputElement ? input.files?.[0] : undefined

	if (!progress) return

	if (!file) {
		progress.textContent = 'Выбери файл'

		return
	}

	// XHR rather than fetch: only it reports upload progress,
	// and exports run to a gigabyte.
	const xhr = new XMLHttpRequest()

	xhr.open('PUT', '/account/upload')
	xhr.setRequestHeader('content-type', 'application/octet-stream')

	xhr.upload.onprogress = (e) => {
		progress.textContent = `Загружено ${Math.round((e.loaded / e.total) * 100)}%`
	}

	xhr.onload = () => {
		if (xhr.status < 300) location.reload()
		else progress.textContent = xhr.responseText || `Ошибка ${xhr.status}`
	}

	xhr.onerror = () => {
		progress.textContent = 'Соединение оборвалось'
	}

	xhr.send(file)
})
