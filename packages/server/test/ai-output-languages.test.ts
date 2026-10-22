import { test } from 'node:test';
import assert from 'node:assert/strict';
import { secretName, secretText, rowsForModel, redactSecrets, redactStep, HIDDEN_VALUE } from '../src/ai-output.ts';

// Password, secret, token, API key, PIN, national ID/SSN, credit card in each language.
const names: Record<string, string[]> = {
  ES: ['Contraseña', 'Secreto', 'Token_de_acceso', 'Clave_API', 'Código_PIN', 'DNI', 'Tarjeta_de_crédito'],
  FR: ['MotDePasse', 'Secret', 'Jeton', 'Clé_API', 'Code_PIN', 'Numéro_de_sécurité_sociale', 'Carte_de_crédit', 'Sécurité_sociale', 'NIR', 'Clef_API'],
  DE: ['Kennwort', 'Geheimnis', 'Zugriffstoken', 'API_Schlüssel', 'Geheimzahl', 'Steueridentifikationsnummer', 'Kreditkarte'],
  NL: ['Wachtwoord', 'Geheim', 'Toegangstoken', 'API_sleutel', 'Pincode', 'Burgerservicenummer', 'Creditcard'],
  IT: ['Parola_d_ordine', 'Segreto', 'Gettone_di_accesso', 'Chiave_API', 'Codice_PIN', 'Codice_fiscale', 'Carta_di_credito', 'Parola_segreta'],
  PT: ['Senha', 'Segredo', 'Token_de_acesso', 'Chave_API', 'Código_PIN', 'CPF', 'Cartão_de_crédito'],
  SV: ['Lösenord', 'Hemlighet', 'Åtkomsttoken', 'API_nyckel', 'Pinkod', 'Personnummer', 'Kreditkort'],
  DA: ['Adgangskode', 'Hemmelighed', 'Adgangstoken', 'API_nøgle', 'Pinkode', 'CPR_nummer', 'Kreditkort'],
  NO: ['Passord', 'Hemmelighet', 'Tilgangstoken', 'API_nøkkel', 'Pinkode', 'Fødselsnummer', 'Kredittkort'],
  FI: ['Salasana', 'Salaisuus', 'Käyttöoikeustunnus', 'API_avain', 'PIN_koodi', 'Henkilötunnus', 'Luottokortti', 'Luottokortin_numero', 'Sosiaaliturvatunnus', 'HETU'],
  PL: ['Hasło', 'Sekret', 'Token_dostępu', 'Klucz_API', 'Kod_PIN', 'PESEL', 'Karta_kredytowa', 'Numer_karty_kredytowej', 'Tajemnica'],
  JA: ['パスワード', '秘密', 'トークン', 'APIキー', '暗証番号', 'マイナンバー', 'クレジットカード', 'シークレット', 'PINコード', '社会保障番号'],
  ZH: ['密码', '秘密', '令牌', 'API密钥', '个人识别码', '身份证号', '信用卡', '密碼', '權杖', 'API金鑰', '個人識別碼', '身分證號', 'PIN码', 'PIN碼', '社会保障号', '社會保障號'],
  KO: ['비밀번호', '비밀', '토큰', 'API키', '핀번호', '주민등록번호', '신용카드', '시크릿', 'PIN코드'],
  RU: ['Пароль', 'Секрет', 'Токен', 'Ключ_API', 'ПИН', 'СНИЛС', 'Кредитная_карта', 'Тайна', 'Жетон_доступа'],
  // Public password terminology: Google's localized change/reset password instructions.
  TR: ['Şifre'], // https://support.google.com/accounts/answer/41078?hl=tr
  CS: ['Heslo'], // https://support.google.com/accounts/answer/41078?hl=cs
  HU: ['Jelszó'], // https://support.google.com/accounts/answer/41078?hl=hu
  EL: ['Κωδικός πρόσβασης'], // https://support.google.com/accounts/answer/41078?hl=el
  HE: ['סיסמה'], // https://support.google.com/accounts/answer/41078?hl=iw
  AR: ['كلمة المرور'], // https://support.google.com/accounts/answer/41078?hl=ar
};
for (const [language, fields] of Object.entries(names)) test(`F2: ${language} secret names protect fields, SQL and script redaction`, () => {
  for (const field of fields) for (const name of [field, field.toUpperCase(), field.normalize('NFD')]) {
    assert.ok(secretName(`Users::${name}(2)`), name);
    assert.ok(secretText(`SELECT "${name}" FROM Users`), name);
    assert.deepEqual(rowsForModel([{ [name]: 'sensitive-value' }]), [{ [name]: HIDDEN_VALUE }]);
    assert.doesNotMatch(redactSecrets(`Set Variable [ $${name} ; Value: "sensitive-value" ]`), /sensitive-value/);
    assert.doesNotMatch(JSON.stringify(redactStep({ text: `Set Variable [ $${name} ; Value: "sensitive-value" ]` })), /sensitive-value/);
  }
});

test('F2: Unicode boundaries do not treat acronyms inside words as secrets', () => {
  for (const name of ['Spinnaker', 'Épinard', 'Секретарь', 'Description', 'Apiary']) {
    assert.equal(secretName(name), false, name);
  }
});

for (const name of ['Pass Word', 'Ｐａｓｓｗｏｒｄ', 'Pass\u200bword', 'Pa\u200css\u200dword', 'Pass\u2060word', 'Pass\ufeffword',
  'P.a-s_s / w:o!r?d', 'P a s s w o r d', 'Passw0rd', 'P455w0rd', 'S3cr3t', 'Pr1vate Key', 'T0ken', 'ŞİFRE',
  'pаssword', 'sеcret', 'passwоrd', 'рassword', 'seсret', 'api keу', 'αpi key', 'passwοrd', 'sεcret',
  'pass|word', 'pass+word', 'pa$$word', 'p@ssword', 'Pásswörd', 'Pa\u0301sswo\u0308rd', 'wa11et key', 'p@$$w0rd',
  'Секрет+токен', 'Client ÁPI+Key', 'Client αPI|Key', 'Client AP1+Key', 'Client sá1a+sana',
  'Client Páss+Wörd', 'Client Pаss|Wοrd', 'Okapi Key API+Key']) {
  test(`obfuscated secret name is hidden in fields, SQL and scripts: ${name}`, () => {
    assert.ok(secretName(`Users::${name}(2)`), name);
    assert.ok(secretText(`SELECT "${name}" FROM Users`), name);
    assert.deepEqual(rowsForModel([{ [name]: 'sensitive-value' }]), [{ [name]: HIDDEN_VALUE }]);
    const script = `Set Field [ Users::${name} ; "sensitive-value" ]`;
    assert.doesNotMatch(redactSecrets(script), /sensitive-value/);
    assert.doesNotMatch(JSON.stringify(redactStep({ text: script })), /sensitive-value/);
  });
}

for (const name of ['ᴘᴀssᴡᴏʀᴅ', 'раѕѕword', 'ρassword', 'passworԁ', 'аpі kеy', 'ꓑassword', 'ѕесrеt', '🅿assword',
  'ᴬᴾᴵ ᴷᴱᵞ', 'Ⓟⓐⓢⓢⓦⓞⓡⓓ', '🅿🅰🆂🆂🆆🅾🆁🅳', 'ꓑꓮꓢꓢꓪꓳꓣꓓ', '𝖯𝖺𝗌𝗌𝗐𝗈𝗋𝖽', 'ａｐｉ ｋｅｙ',
  'ΡΑSSWΟRD', 'АРІ КЕҮ', 'ᴛᴏᴋᴇɴ', 'ѕѕɴ', 'ⅽⅴⅴ', '🅿️assword']) {
  test(`confusable alphabet protects names and all output redactors: ${name}`, () => {
    for (const variant of [name, name.toUpperCase(), name.normalize('NFD')]) {
      assert.ok(secretName(`Users::${variant}(2)`), variant);
      assert.ok(secretText(`SELECT "${variant}" FROM Users`), variant);
      assert.deepEqual(rowsForModel([{ [variant]: 'synthetic-secret-77' }]), [{ [variant]: HIDDEN_VALUE }]);
      assert.doesNotMatch(redactSecrets(`Set Field [ Users::${variant} ; "synthetic-secret-77" ]`), /synthetic-secret-77/);
    }
  });
}

test('normalization preserves existing acronym and digit-bearing secret names and safe names', () => {
  for (const name of ['PIN code', 'API key', 'API keys', '2FA code', 'CVV2', 'CVC2', 'Users::Password(12)']) assert.ok(secretName(name), name);
  for (const name of ['Spinnaker', 'Épinard', 'Секретарь', 'Secretary', 'Description', 'Apiary', 'PasswordVault::Name', 'Part 10', 'Version 2']) assert.equal(secretName(name), false, name);
});

test('joined matches start at an original word boundary after folding and digit substitutions', () => {
  assert.ok(secretName('Client wa11et+Key'));
  for (const name of ['Okapi Key', 'Ókápí+Key', 'Okαpi|Key', 'Okap1+Key', 'Compass Word', 'Cómpáss+Wörd']) {
    assert.equal(secretName(`Items::${name}(2)`), false, name);
    assert.equal(secretText(`SELECT "${name}" FROM Items`), false, name);
    assert.deepEqual(rowsForModel([{ [name]: 'visible-value' }]), [{ [name]: 'visible-value' }]);
    const script = `Set Field [ Items::${name} ; "visible-value" ]`;
    assert.equal(redactSecrets(script), script);
    assert.equal(redactStep({ text: script }).text, script);
  }
});

// Optional decoded script metadata has always been accepted by this generic redactor.
test('redaction preserves absent step metadata', () => {
  assert.equal(redactStep(undefined), undefined);
  assert.equal(redactStep(null), null);
});

test('redactStep hides credentials carried inside a step option, whatever the option is called', () => {
  const secret = 'Zq9xHunterSecret';
  for (const value of [
    `curl -H "Authorization: Basic dXNlcjpaWjk5eHl6" https://example.test/x`,
    `Cookie: sid=${secret}`,
    `Set-Cookie: sid=${secret}; Path=/`,
    `https://example.test/path?password=${secret}&x=1`,
    `https://example.test/path?token=${secret}&x=1`,
    `api_key=${secret}`,
    `X-API-Key: ${secret}`,
  ]) {
    const hidden = JSON.stringify(redactStep({ params: { Url: value }, other: [value] }));
    assert.ok(!hidden.includes(secret) && !hidden.includes('dXNlcjpaWjk5eHl6'), value);
  }
  const plain = { params: { Url: 'https://example.test/path?page=2', Note: 'Okapi Key' } };
  assert.deepEqual(redactStep(plain), plain);
});
