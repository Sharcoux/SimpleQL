module.exports = {
    env: {
        browser: true,
        commonjs: true,
        es2021: true
    },
    extends: [
        'standard'
    ],
    parserOptions: {
        ecmaVersion: 12
    },
    rules: {
        'prefer-promise-reject-errors': 'off',
        'no-return-assign': 'off',
        'brace-style': 'off',
        'multiline-ternary': 'off'
    }
}
