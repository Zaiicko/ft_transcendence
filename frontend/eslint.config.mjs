import eslint from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', 'node_modules/', 'public/'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  // The react-hooks plugin still ships a legacy-format config — wire its
  // rules manually into flat config
  {
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
);
