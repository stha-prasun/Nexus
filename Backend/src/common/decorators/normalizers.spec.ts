import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { NormalizeEmail } from './normalize-email.decorator';
import { NormalizeName } from './normalize-name.decorator';
import { Trim } from './trim.decorator';

class TrimDto {
  @Trim()
  value!: string;
}

class NameDto {
  @NormalizeName()
  name!: string;
}

class EmailDto {
  @NormalizeEmail()
  email!: string;
}

describe('normalizer decorators', () => {
  describe('@Trim', () => {
    it('trims leading and trailing whitespace', () => {
      const dto = plainToInstance(TrimDto, { value: '  hello  ' });
      expect(dto.value).toBe('hello');
    });

    it('leaves non-strings untouched', () => {
      const dto = plainToInstance(TrimDto, { value: 42 });
      expect(dto.value).toBe(42);
    });
  });

  describe('@NormalizeName', () => {
    it('trims and collapses internal whitespace', () => {
      const dto = plainToInstance(NameDto, { name: '  Ada   Lovelace  ' });
      expect(dto.name).toBe('Ada Lovelace');
    });

    it('strips control characters', () => {
      const dto = plainToInstance(NameDto, {
        name: `Ada${String.fromCharCode(7)}${String.fromCharCode(0)}Lovelace`,
      });
      expect(dto.name).toBe('AdaLovelace');
    });

    it('collapses newlines to spaces before stripping', () => {
      const dto = plainToInstance(NameDto, { name: 'Ada\nLovelace' });
      expect(dto.name).toBe('Ada Lovelace');
    });

    it('leaves non-strings untouched', () => {
      const dto = plainToInstance(NameDto, { name: null });
      expect(dto.name).toBeNull();
    });
  });

  describe('@NormalizeEmail', () => {
    it('trims and lowercases', () => {
      const dto = plainToInstance(EmailDto, { email: '  Ada@Example.COM ' });
      expect(dto.email).toBe('ada@example.com');
    });

    it('strips control characters', () => {
      const dto = plainToInstance(EmailDto, {
        email: `ada${String.fromCharCode(0)}@example.com`,
      });
      expect(dto.email).toBe('ada@example.com');
    });

    it('leaves non-strings untouched', () => {
      const dto = plainToInstance(EmailDto, { email: undefined });
      expect(dto.email).toBeUndefined();
    });
  });
});
