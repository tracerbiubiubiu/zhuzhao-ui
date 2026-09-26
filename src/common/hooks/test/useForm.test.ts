import assert from 'node:assert/strict'
import { test } from 'vitest'
import { required, useForm } from '../src/useForm'

type Values = {
  username: string
  password: string
  confirmPassword: string
}

// 适配：原为独立 node 脚本（顶层断言），包进 vitest test() 让 pnpm test 收集运行；
// 断言与语义零改动。
test('covers form validation, submission, errors and reset', async () => {
  const form = useForm<Values>({
    initialValues: {
      username: '',
      password: '',
      confirmPassword: ''
    },
    rules: {
      username: required('username is required'),
      password: required('password is required'),
      confirmPassword: (value, values) =>
        value === values.password ? undefined : 'passwords do not match'
    }
  })

  assert.equal(form.state.dirty.value, false)

  let submitted = false
  const invalidResult = await form.actions.submit(() => {
    submitted = true
  })
  assert.equal(invalidResult, undefined)
  assert.equal(submitted, false)
  assert.deepEqual(form.state.errors.value.username, ['username is required'])
  assert.deepEqual(form.state.touchedFields.value, ['username', 'password', 'confirmPassword'])

  form.actions.setValues({
    username: 'admin',
    password: 'secret',
    confirmPassword: 'different'
  })
  assert.equal(form.state.dirty.value, true)
  assert.equal(await form.actions.validateField('confirmPassword'), false)
  assert.deepEqual(form.state.errors.value.confirmPassword, ['passwords do not match'])

  form.actions.setValue('confirmPassword', 'secret')
  form.actions.setErrors({ username: 'server rejected username' })
  assert.deepEqual(form.state.errors.value.username, ['server rejected username'])
  form.actions.clearErrors('username')

  const result = await form.actions.submit((values) => `${values.username}:ok`)
  assert.equal(result, 'admin:ok')
  assert.equal(form.state.submitCount.value, 2)
  assert.equal(form.state.hasErrors.value, false)

  form.actions.reset({
    username: 'remembered',
    password: 'saved',
    confirmPassword: 'saved'
  })
  assert.equal(form.state.dirty.value, false)
  assert.equal(form.state.values.value.username, 'remembered')
  assert.deepEqual(form.state.errors.value, {})
  assert.deepEqual(form.state.touchedFields.value, [])

  console.log('✓ covers form validation, submission, errors and reset')
})
