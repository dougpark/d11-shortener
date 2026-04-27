/** @type {import('tailwindcss').Config} */
module.exports = {
    content: ["./src/**/*.{html,js,ts,jsx,tsx}"],
    theme: {
        extend: {
            colors: {
                gemini: {
                    blue: '#4285F4',
                    black: '#1F1F1F',
                    gray: '#474747',
                    border: '#E3E3E3',
                    surface: '#FFFFFF',
                },
            },
            borderRadius: {
                'gemini-sm': '12px',
                'gemini-lg': '24px',
                'gemini-full': '9999px',
            },
            fontFamily: {
                // Inter is the best open-source match for the look in your screenshot
                sans: ['Inter', 'Roboto', 'sans-serif'],
            },
            boxShadow: {
                'gemini-soft': '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
            }
        },
    },
    plugins: [],
}
