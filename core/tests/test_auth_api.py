from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from core.models import Profile

User = get_user_model()


class AuthApiTests(APITestCase):
    def test_signup_requires_unique_email_case_insensitive(self):
        User.objects.create_user(username="existing", email="taken@example.com", password="StrongPass123!")

        payload = {
            "username": "new-user",
            "email": "TAKEN@example.com",
            "password": "StrongPass123!",
            "password_confirm": "StrongPass123!",
        }
        response = self.client.post(reverse("auth-signup"), payload, format="json")

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("email", response.data)

    def test_signup_creates_default_profile_and_stores_email(self):
        payload = {
            "username": "new-user",
            "email": "new-user@example.com",
            "password": "StrongPass123!",
            "password_confirm": "StrongPass123!",
        }
        response = self.client.post(reverse("auth-signup"), payload, format="json")

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        user = User.objects.get(username="new-user")
        self.assertEqual(user.email, "new-user@example.com")
        self.assertTrue(Profile.objects.filter(account=user, name="Default").exists())

