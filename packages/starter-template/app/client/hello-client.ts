export function greetClient() {
  const el = document.getElementById('client-greeting');
  if (el) {
    el.textContent = 'Hello from custom client JS';
  }
}
